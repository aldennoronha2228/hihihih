import asyncio
import json

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage, ToolMessage
from langchain_groq import ChatGroq

from backend import agent


def tool(name, args, call_id='call-1', prose=''):
    return AIMessageChunk(content=prose, tool_call_chunks=[{
        'name': name, 'args': json.dumps(args), 'id': call_id, 'index': 0,
    }])


class FakeModel:
    def __init__(self, turns):
        self.turns = turns
        self.histories = []
        self.tools = []
        self.closed = 0
        self.tool_choices = []

    def bind_tools(self, tools, **kwargs):
        self.tools = tools
        self.tool_choice = kwargs.get('tool_choice')
        self.tool_choices.append(self.tool_choice)
        return self

    async def astream(self, history):
        self.histories.append(list(history))
        index = len(self.histories) - 1
        turn = self.turns[min(index, len(self.turns) - 1)]
        try:
            for chunk in turn:
                if isinstance(chunk, Exception):
                    raise chunk
                yield chunk
        finally:
            self.closed += 1


class FakeService:
    def __init__(self):
        self.calls = []
        self.result = {'success': True}
        self.board = 'arduino-uno'

    def get_project(self, project_id):
        return {'id': project_id, 'board': self.board, 'components': []}

    async def command(self, project_id, name, args, runtime_token=None):
        self.calls.append((project_id, name, args, runtime_token))
        if name == 'read_project':
            return {'id': project_id, 'board': self.board, 'revision': 4, 'runtime_token': runtime_token}
        if name == 'calculator':
            return {'expression': args['expression'], 'result': 4}
        return self.result


def collect(model, history=None, **kwargs):
    async def run():
        return [item async for item in agent.stream_agent(model, history or [HumanMessage(content='Hi')], **kwargs)]
    return asyncio.run(run())


@pytest.fixture
def service(monkeypatch):
    service = FakeService()
    monkeypatch.setattr(agent, '_get_service', lambda: service)

    async def calculator(expression):
        return await service.command(None, 'calculator', {'expression': expression})

    monkeypatch.setattr(agent, '_calculator', calculator)
    return service


def questionnaire():
    return {
        'summary': 'Choose the remaining LED behavior settings.',
        'questions': [
            {'id': 'behavior', 'question': 'How should the LED behave?', 'options': [
                {'id': 'blink', 'label': 'Blink'}, {'id': 'steady', 'label': 'Stay on'},
            ]},
            {'id': 'timing', 'question': 'Which blink interval?', 'options': [
                {'id': 'slow', 'label': 'One second'}, {'id': 'fast', 'label': 'Half a second'},
            ]},
            {'id': 'runtime', 'question': 'What should run after building?', 'options': [
                {'id': 'compile', 'label': 'Compile only'}, {'id': 'simulate', 'label': 'Start simulation'},
            ]},
        ],
    }


def test_greeting_has_no_persistent_model_row(service):
    model = FakeModel([[AIMessageChunk(content='Hello '), AIMessageChunk(content='there')]])
    events = collect(model)
    assert [event['type'] for event in events] == ['text', 'text', 'done']
    assert events[-1]['status'] == 'success'
    assert events[-1]['modelCalls'] == 1
    assert service.calls == []
    assert {item.name for item in model.tools} == set(agent.TOOL_NAMES)
    assert len(model.tools) == len(agent.TOOL_NAMES)
    assert all('project_id' not in item.args and 'runtime_token' not in item.args for item in model.tools)
    assert model.histories[0][0].type == 'system'
    assert all(json.dumps(event) for event in events)


def test_calculator_feedback_and_selection_prose_suppressed(service):
    model = FakeModel([
        [AIMessageChunk(content='', additional_kwargs={'reasoning_content': 'Provider reasoning'}),
         tool('calculator', {'expression': '2+2'}, prose='Let me calculate.')],
        [AIMessageChunk(content='It is 4.')],
    ])
    events = collect(model)
    assert [event['type'] for event in events] == ['text', 'step_start', 'step_end', 'text', 'done']
    assert events[0]['channel'] == 'thinking'
    assert 'Let me' not in json.dumps(events)
    assert service.calls == [(None, 'calculator', {'expression': '2+2'}, None)]
    feedback = model.histories[1][-1]
    assert isinstance(feedback, ToolMessage)
    assert feedback.tool_call_id == 'call-1'
    assert json.loads(feedback.content)['result'] == 4
    assert 'reasoning_content' not in model.histories[1][-2].additional_kwargs
    assert events[-1]['toolCalls'] == 1


def test_hardware_sequence_scoped_unique_and_redacted(service):
    model = FakeModel([
        [tool('read_project', {}, 'read')],
        [tool('add_component', {'type': 'wokwi-led', 'expected_revision': 4}, 'add')],
        [tool('generate_firmware', {'source': 'void setup() {}\nvoid loop() {}'}, 'source')],
        [tool('compile_firmware', {}, 'compile')],
        [AIMessageChunk(content='Compiled, not running.')],
    ])
    events = collect(model, project_id='current', runtime_token='private-token', requirements={'behavior': 'blink'})
    assert [call[1] for call in service.calls] == ['read_project', 'add_component', 'generate_firmware', 'compile_firmware']
    assert all(call[0] == 'current' and call[3] == 'private-token' for call in service.calls)
    starts = [item for item in events if item['type'] == 'step_start']
    ends = [item for item in events if item['type'] == 'step_end']
    assert len({item['id'] for item in starts}) == 4
    assert [item['id'] for item in starts] == [item['id'] for item in ends]
    assert all(item['status'] == 'success' for item in ends)
    assert 'private-token' not in json.dumps(events)
    assert 'private-token' not in str(model.histories)


@pytest.mark.parametrize('name,args,project,error', [
    ('read_project', {}, None, 'Select or create'),
    ('add_component', {'type': 'wokwi-led'}, 'current', 'read_project'),
    ('calculator', {'expression': '2+2', 'project_id': 'other'}, None, 'Invalid tool arguments'),
    ('calculator', {'expression': 3}, None, 'Invalid tool arguments'),
    ('edit_firmware', {'old': 'x'}, 'current', 'either source'),
    ('shell', {'command': 'whoami'}, 'current', 'Unknown tool'),
])
def test_validation_feedback(service, name, args, project, error):
    model = FakeModel([[tool(name, args)], [AIMessageChunk(content='Cannot complete the operation.')]])
    events = collect(model, project_id=project)
    end = next(item for item in events if item['type'] == 'step_end')
    assert end['status'] == 'error'
    assert error in end['output']
    assert model.histories[1][-1].status == 'error'
    assert not service.calls


def test_failed_tool_result_is_error_and_feedback(service):
    service.result = {'status': 'error', 'error': 'Compiler is unavailable'}
    model = FakeModel([[tool('read_project', {}, 'r')], [tool('compile_firmware', {}, 'c')], [AIMessageChunk(content='Compiler unavailable.')]])
    events = collect(model, project_id='current', requirements={'behavior': 'blink'})
    assert [item['status'] for item in events if item['type'] == 'step_end'] == ['success', 'error']
    assert [call[1] for call in service.calls] == ['read_project', 'compile_firmware']
    assert 'Compiler is unavailable' in json.dumps(events)
    assert model.histories[-1][-1].status == 'error'


def test_duplicate_ids_never_replay_mutation(service):
    model = FakeModel([
        [tool('read_project', {}, 'read')],
        [tool('add_component', {'type': 'wokwi-led'}, 'same')],
        [tool('add_component', {'type': 'wokwi-led'}, 'same')],
        [AIMessageChunk(content='Finished.')],
    ])
    events = collect(model, project_id='current', requirements={'behavior': 'blink'})
    assert [item[1] for item in service.calls].count('add_component') == 1
    assert 'Duplicate tool call ID' in json.dumps(events)


def test_model_failure_does_not_retry_completed_tool(service):
    model = FakeModel([[tool('calculator', {'expression': '2+2'})], [RuntimeError('secret-key')]])
    events = collect(model)
    assert len(service.calls) == 1
    assert len(model.histories) == 2
    assert events[-1]['status'] == 'error'
    assert 'secret-key' not in json.dumps(events)


def test_call_bounds(service, monkeypatch):
    monkeypatch.setattr(agent, 'MAX_TOOL_CALLS', 1)
    model = FakeModel([[tool('calculator', {'expression': '2+2'}, 'one')], [tool('calculator', {'expression': '2+2'}, 'two')]])
    events = collect(model)
    assert len(service.calls) == 1
    assert events[-1]['reason'] == 'limit'
    monkeypatch.setattr(agent, 'MAX_MODEL_CALLS', 1)
    model = FakeModel([[tool('calculator', {'expression': '2+2'})]])
    events = collect(model)
    assert len(model.histories) == 1
    assert events[-1]['reason'] == 'limit'


def test_recursion_bound(service, monkeypatch):
    monkeypatch.setattr(agent, 'RECURSION_LIMIT', 1)
    model = FakeModel([[tool('calculator', {'expression': '2+2'})]])
    events = collect(model)
    assert events[-1]['reason'] == 'limit'
    assert 'recursion limit' in json.dumps(events)


def test_fragmented_multiple_tool_calls(service):
    model = FakeModel([
        [AIMessageChunk(content='Selecting tools'),
         AIMessageChunk(content='', tool_call_chunks=[{'name': 'calculator', 'args': '{"expression":', 'id': 'a', 'index': 0}]),
         AIMessageChunk(content='', tool_call_chunks=[{'name': None, 'args': '"2+2"}', 'id': None, 'index': 0}]),
         AIMessageChunk(content='', tool_call_chunks=[{'name': 'calculator', 'args': '{"expression":"2*2"}', 'id': 'b', 'index': 1}])],
        [AIMessageChunk(content='Both are 4.')],
    ])
    events = collect(model)
    assert len(service.calls) == 2
    assert [call[2]['expression'] for call in service.calls] == ['2+2', '2*2']
    assert 'Selecting tools' not in json.dumps(events)
    assert len([item for item in model.histories[1] if isinstance(item, ToolMessage)]) == 2


def test_timeout_closes_model(service, monkeypatch):
    deadline = asyncio.timeout
    contexts = []

    def injected_timeout(seconds):
        context = deadline(None)
        contexts.append(context)
        return context

    monkeypatch.setattr(agent.asyncio, 'timeout', injected_timeout)

    class SlowModel(FakeModel):
        async def astream(self, history):
            contexts[-1].reschedule(asyncio.get_running_loop().time() + 0.1)
            try:
                await asyncio.Event().wait()
                yield AIMessageChunk(content='never')
            finally:
                self.closed += 1

    model = SlowModel([])
    events = collect(model)
    assert events[-1]['reason'] == 'timeout'
    assert model.closed == 1


def test_cancel_active_tool_and_generator_close(service, monkeypatch):
    async def run(close):
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def command(*args, **kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        monkeypatch.setattr(service, 'command', command)
        model = FakeModel([[tool('calculator', {'expression': '2+2'})]])
        stream = agent.stream_agent(model, [HumanMessage(content='Calculate')])
        first = await anext(stream)
        assert first['type'] == 'step_start'
        await entered.wait()
        if close:
            await stream.aclose()
        else:
            task = asyncio.create_task(anext(stream))
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            await stream.aclose()
        await asyncio.wait_for(cancelled.wait(), 1)

    asyncio.run(run(True))
    asyncio.run(run(False))


def test_actual_groq_binding_disables_transport_retries(monkeypatch):
    model = ChatGroq(api_key='fake-key', model='openai/gpt-oss-120b', max_retries=2,
                     model_kwargs={'include_reasoning': True})
    captured = {}

    async def astream(self, history, config=None, **kwargs):
        captured['tools'] = kwargs['tools']
        captured['retries'] = self.async_client._client.max_retries
        captured['model_retries'] = self.max_retries
        captured['reasoning'] = self.model_kwargs['include_reasoning']
        yield AIMessageChunk(content='Hello')

    monkeypatch.setattr(ChatGroq, 'astream', astream)
    events = collect(model)
    assert events[-1]['status'] == 'success'
    assert len(captured['tools']) == len(agent.TOOL_NAMES)
    assert captured['retries'] == captured['model_retries'] == 0
    assert captured['reasoning'] is True
    assert model.max_retries == model.async_client._client.max_retries == 2


def test_real_calculator_without_project():
    model = FakeModel([[tool('calculator', {'expression': '(2+3)*4'})], [AIMessageChunk(content='20')]])
    events = collect(model)
    end = next(item for item in events if item['type'] == 'step_end')
    assert end['status'] == 'success'
    assert json.loads(end['output'])['result'] == 20


def test_real_hardware_source_mutation(tmp_path, monkeypatch):
    from backend.hardware import HardwareService

    service = HardwareService(data_dir=tmp_path)
    project = service.create_project()
    monkeypatch.setattr(agent, '_get_service', lambda: service)
    source = 'void setup() {}\nvoid loop() {}'
    model = FakeModel([
        [tool('read_project', {}, 'read')],
        [tool('edit_firmware', {'source': source, 'expected_revision': 1}, 'edit')],
        [tool('read_firmware', {}, 'firmware')],
        [AIMessageChunk(content='Firmware updated.')],
    ])
    events = collect(model, project_id=project['id'], runtime_token=project['runtime_token'],
                     requirements={'behavior': 'idle'})
    assert all(item['status'] == 'success' for item in events if item['type'] == 'step_end')
    updated = service.get_project(project['id'])
    assert updated['revision'] == 2
    assert updated['firmware']['source'] == source
    assert updated['runtime_token'] not in json.dumps(events)


def test_timeout_active_tool_has_matching_error_end(service, monkeypatch):
    deadline = asyncio.timeout
    contexts = []
    closed = []

    def injected_timeout(seconds):
        context = deadline(None)
        contexts.append(context)
        return context

    monkeypatch.setattr(agent.asyncio, 'timeout', injected_timeout)

    async def command(*args, **kwargs):
        contexts[-1].reschedule(asyncio.get_running_loop().time() + 0.1)
        try:
            await asyncio.Event().wait()
        finally:
            closed.append(True)

    monkeypatch.setattr(service, 'command', command)
    model = FakeModel([[tool('calculator', {'expression': '2+2'})]])
    events = collect(model)
    start = next(item for item in events if item['type'] == 'step_start')
    end = next(item for item in events if item['type'] == 'step_end')
    assert start['id'] == end['id']
    assert end['status'] == 'error'
    assert events[-1]['reason'] == 'timeout'
    assert closed == [True]


def test_initial_build_asks_mcqs_and_pauses_without_hardware(service):
    questions = questionnaire()
    model = FakeModel([
        [tool('ask_project_questions', questions, 'questions')],
        [RuntimeError('The agent must pause before another model call.')],
    ])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build a blinking LED circuit')])
    assert [item.name for item in model.tools] == ['ask_project_questions']
    assert model.tool_choice == 'required'
    assert service.calls == []
    activity = [item for item in events if item['type'] != 'text']
    assert [item['type'] for item in activity] == ['step_start', 'step_end', 'questions', 'done']
    assert activity[0]['id'] == activity[1]['id']
    assert activity[1]['status'] == 'success'
    assert activity[2] == {'type': 'questions', **questions}
    assert events[-1]['status'] == 'awaiting_answers'
    assert events[-1]['reason'] == 'requirements_required'
    assert events[-1]['modelCalls'] == events[-1]['toolCalls'] == 1
    assert len(model.histories) == 1
    assert 'I will build' not in json.dumps(events)


def test_question_turn_ignores_following_hardware_calls(service):
    question_call = tool('ask_project_questions', questionnaire(), 'questions')
    mutation = AIMessageChunk(content='', tool_call_chunks=[{
        'name': 'add_component', 'args': '{"type":"wokwi-led"}', 'id': 'add', 'index': 1,
    }])
    model = FakeModel([[question_call, mutation], [RuntimeError('Must not resume yet')]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build an LED circuit')])
    assert service.calls == []
    assert len([item for item in events if item['type'] == 'step_start']) == 1
    assert events[-1]['status'] == 'awaiting_answers'
    assert events[-1]['toolCalls'] == 1


@pytest.mark.parametrize('invalid', ['no_questions', 'too_many', 'duplicate_questions', 'duplicate_options', 'single_option'])
def test_invalid_mcqs_do_not_pause_or_dispatch(service, invalid):
    questions = questionnaire()
    if invalid == 'no_questions':
        questions['questions'].clear()
    elif invalid == 'too_many':
        questions['questions'] *= 2
    elif invalid == 'duplicate_questions':
        questions['questions'][1]['id'] = questions['questions'][0]['id']
    elif invalid == 'duplicate_options':
        questions['questions'][0]['options'][1]['id'] = 'blink'
    else:
        questions['questions'][0]['options'].pop()
    model = FakeModel([[tool('ask_project_questions', questions)], [AIMessageChunk(content='Please retry.')]])
    events = collect(model)
    end = next(item for item in events if item['type'] == 'step_end')
    assert end['status'] == 'error'
    assert not any(item['type'] == 'questions' for item in events)
    assert model.histories[1][-1].status == 'error'
    assert service.calls == []


@pytest.mark.parametrize('name,args', [
    ('add_component', {'type': 'wokwi-led'}),
    ('edit_firmware', {'source': 'void setup() {}\nvoid loop() {}'}),
    ('compile_firmware', {}),
    ('run_simulation', {}),
])
def test_mutation_compile_and_run_require_user_confirmation(service, name, args):
    model = FakeModel([
        [tool('read_project', {}, 'read')], [tool(name, args, 'operation')],
        [AIMessageChunk(content='Requirements are needed.')],
    ])
    events = collect(model, project_id='current')
    assert [call[1] for call in service.calls] == ['read_project']
    ends = [item for item in events if item['type'] == 'step_end']
    assert [item['status'] for item in ends] == ['success', 'error']
    assert 'User-confirmed requirements' in ends[-1]['output']
    assert model.histories[-1][-1].status == 'error'


def test_initial_build_rejects_unbound_hardware_tool(service):
    model = FakeModel([[tool('read_project', {})], [AIMessageChunk(content='No changes were made.')]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build an LED circuit')])
    assert service.calls == []
    end = next(item for item in events if item['type'] == 'step_end')
    assert end['status'] == 'error'
    assert 'ask_project_questions first' in end['output']
    assert events[-1]['status'] == 'error'


@pytest.mark.parametrize('prefix', [False, True])
def test_confirmed_answers_are_context_and_resume_actual_mutation(service, prefix):
    answers = {'behavior': 'blink', 'timing': 'slow', 'runtime': 'not_run'}
    content = 'Build the LED circuit now'
    kwargs = {'requirements': answers}
    if prefix:
        content = 'Project requirements confirmed: ' + json.dumps(answers) + '\n' + content
        kwargs = {}
    model = FakeModel([
        [tool('read_project', {}, 'read')],
        [tool('add_component', {'type': 'wokwi-led'}, 'add')],
        [AIMessageChunk(content='Added the LED.')],
    ])
    events = collect(model, project_id='current', history=[HumanMessage(content=content)], **kwargs)
    assert len(model.tools) == len(agent.TOOL_NAMES)
    assert [call[1] for call in service.calls] == ['read_project', 'add_component']
    assert service.calls[-1][2]['expected_revision'] == 4
    assert not any(item['type'] == 'questions' for item in events)
    assert events[-1]['status'] == 'success'
    context = next(message for message in model.histories[0]
                   if message.type == 'system' and 'The user confirmed these project requirements:' in message.content)
    assert json.dumps(answers) in context.content
    assert 'Do not ask requirements questions again' in context.content


def test_confirmed_requirements_cannot_be_requested_again(service):
    model = FakeModel([[tool('ask_project_questions', questionnaire())], [AIMessageChunk(content='Confirmed already.')]])
    events = collect(model, requirements={'behavior': 'blink'})
    end = next(item for item in events if item['type'] == 'step_end')
    assert end['status'] == 'error'
    assert 'already confirmed' in end['output']
    assert not any(item['type'] == 'questions' for item in events)
    assert service.calls == []


def test_confirmed_build_cannot_succeed_with_advice_only(service):
    model = FakeModel([[AIMessageChunk(content='Connect an LED and upload this code.')]])
    events = collect(model, project_id='current', requirements={'behavior': 'blink'},
                     history=[HumanMessage(content='Build an LED circuit')])
    assert events[-1]['status'] == 'error'
    assert events[-1]['reason'] == 'build_not_executed'
    assert not any(item.get('channel') == 'answer' for item in events)
    assert service.calls == []


def test_injected_model_call_bound_is_enforced(service):
    model = FakeModel([[tool('calculator', {'expression': '2+2'})], [AIMessageChunk(content='4')]])
    events = collect(model, max_model_calls=1)
    assert len(model.histories) == 1
    assert len(service.calls) == 1
    assert events[-1]['status'] == 'error'
    assert events[-1]['reason'] == 'limit'


def test_injected_timeout_bound_cancels_model(service, monkeypatch):
    deadline = asyncio.timeout
    requested = []
    contexts = []

    def injected_timeout(seconds):
        requested.append(seconds)
        context = deadline(None)
        contexts.append(context)
        return context

    class SlowModel(FakeModel):
        async def astream(self, history):
            contexts[-1].reschedule(asyncio.get_running_loop().time() + 0.1)
            try:
                await asyncio.Event().wait()
                yield AIMessageChunk(content='never')
            finally:
                self.closed += 1

    monkeypatch.setattr(agent.asyncio, 'timeout', injected_timeout)
    model = SlowModel([])
    events = collect(model, timeout_seconds=0.1)
    assert model.closed == 1
    assert events[-1]['reason'] == 'timeout'
    assert requested == [0.1]


def test_empty_project_injects_first_canonical_board_question(service):
    service.board = 'unselected'
    model = FakeModel([[tool('ask_project_questions', questionnaire())]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build a pi-pico-w circuit')])
    questions = next(event['questions'] for event in events if event['type'] == 'questions')
    assert questions[0]['id'] == 'board'
    options = questions[0]['options']
    assert options[0]['id'] == 'pi-pico-w'
    assert len(options) <= 6
    assert all(option['id'] in agent._board_catalog() or option['id'] == 'none' for option in options)
    assert any(option['id'] == 'none' for option in options)
    assert service.calls == []
    assert events[-1]['status'] == 'awaiting_answers'


def test_dynamic_board_only_question_is_valid_and_reordered(service):
    service.board = 'unselected'
    board_question = {'id': 'board', 'question': 'Which controller?', 'options': [
        {'id': 'esp32-s3', 'label': 'ESP32-S3'}, {'id': 'none', 'label': 'Analog only'},
    ]}
    model = FakeModel([[tool('ask_project_questions', {'summary': 'Select hardware.', 'questions': [board_question]})]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build this circuit')])
    assert next(event['questions'] for event in events if event['type'] == 'questions') == [board_question]
    assert events[-1]['status'] == 'awaiting_answers'
    questions = questionnaire()
    questions['questions'].append(board_question)
    model = FakeModel([[tool('ask_project_questions', questions)]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build this circuit')])
    assert next(event['questions'] for event in events if event['type'] == 'questions')[0] == board_question


def test_existing_project_omits_board_question(service):
    questions = questionnaire()
    questions['questions'].insert(0, agent._board_question(''))
    model = FakeModel([[tool('ask_project_questions', questions)]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build an LED circuit')])
    assert all(question['id'] != 'board' for event in events if event['type'] == 'questions'
               for question in event['questions'])
    assert 'already uses board arduino-uno' in str(model.histories[0])
    assert service.calls == []


@pytest.mark.parametrize('board_key', ['esp32', 'wokwi-arduino-uno', 'invented-board'])
def test_invalid_board_options_are_rejected(service, board_key):
    service.board = 'unselected'
    questions = {'summary': 'Select a board.', 'questions': [{'id': 'board', 'question': 'Which board?',
                 'options': [{'id': board_key, 'label': 'Controller'}, {'id': 'none', 'label': 'None'}]}]}
    model = FakeModel([[tool('ask_project_questions', questions)], [AIMessageChunk(content='Unable to plan.')]])
    events = collect(model, project_id='current', history=[HumanMessage(content='Build a circuit')])
    assert not any(event['type'] == 'questions' for event in events)
    assert 'canonical catalog board keys' in json.dumps(events)
    assert service.calls == []


@pytest.mark.parametrize('board_key', ['esp32', 'unselected', 'invented-board'])
def test_invalid_confirmed_board_is_rejected_before_model(service, board_key):
    model = FakeModel([[RuntimeError('Must not call model')]])
    events = collect(model, project_id='current', requirements={'board': board_key},
                     history=[HumanMessage(content='Build this circuit')])
    assert events[-1]['reason'] == 'invalid_requirements'
    assert model.histories == []
    assert service.calls == []


def test_confirmed_board_is_placed_after_model_read_with_regular_events(service):
    service.board = 'unselected'
    service.result = {'id': 'current', 'revision': 5, 'board': 'pi-pico-w',
                      'components': [{'id': 'board', 'type': 'pi-pico-w'}]}
    model = FakeModel([[tool('read_project', {}, 'read')], [AIMessageChunk(content='Selected Pico W; runtime remains unavailable.')]])
    events = collect(model, project_id='current', requirements={'board': 'pi-pico-w'},
                     history=[HumanMessage(content='Build this circuit')])
    assert [call[1] for call in service.calls] == ['read_project', 'add_component']
    assert service.calls[1][2] == {'type': 'pi-pico-w', 'expected_revision': 4}
    starts = [event for event in events if event['type'] == 'step_start']
    ends = [event for event in events if event['type'] == 'step_end']
    assert len(starts) == len(ends) == 2
    assert [event['id'] for event in starts] == [event['id'] for event in ends]
    assert model.tool_choices == ['required', 'auto']
    assert events[-1]['changes']['componentsAdded'] == 1
    assert events[-1]['status'] == 'success'
    assert isinstance(model.histories[1][-1], ToolMessage)
    assert model.histories[1][-1].name == 'add_component'


@pytest.mark.parametrize('board_key', [None, 'none'])
def test_no_board_is_added_without_a_confirmed_board_key(service, board_key):
    service.board = 'unselected'
    answers = {'behavior': 'analog'} if board_key is None else {'board': board_key}
    model = FakeModel([[tool('read_project', {}, 'read')],
                       [tool('add_component', {'type': 'arduino-uno'}, 'add')],
                       [AIMessageChunk(content='No board was authorized.')]])
    events = collect(model, project_id='current', requirements=answers,
                     history=[HumanMessage(content='Build an analog circuit')])
    assert [call[1] for call in service.calls] == ['read_project']
    assert 'canonical key in the confirmed board answer' in json.dumps(events)
    assert model.tool_choices == ['required', 'required', 'required']
    assert events[-1]['changes']['componentsAdded'] == 0


def test_existing_board_is_not_replaced_by_confirmation_bootstrap(service):
    model = FakeModel([[tool('read_project', {}, 'read')],
                       [tool('add_component', {'type': 'led'}, 'add')], [AIMessageChunk(content='Added LED.')]])
    events = collect(model, project_id='current', requirements={'board': 'pi-pico'},
                     history=[HumanMessage(content='Build an LED circuit')])
    assert [call[2]['type'] for call in service.calls if call[1] == 'add_component'] == ['led']
    assert model.tool_choices == ['required', 'required', 'auto']
    assert events[-1]['status'] == 'success'


def test_failed_board_placement_reports_error_without_successful_mutation(service):
    service.board = 'unselected'
    service.result = {'status': 'error', 'error': 'Board placement unavailable'}
    model = FakeModel([[tool('read_project', {}, 'read')], [AIMessageChunk(content='Build blocked.')]])
    events = collect(model, project_id='current', requirements={'board': 'arduino-uno'},
                     history=[HumanMessage(content='Build this circuit')])
    assert [call[1] for call in service.calls] == ['read_project', 'add_component']
    assert events[-1]['changes']['componentsAdded'] == 0
    assert events[-1]['status'] == 'error'
    assert model.tool_choices == ['required', 'required']
    assert 'Board placement unavailable' in json.dumps(events)


def test_build_model_text_streams_live_narration_without_generic_model_step(service):
    model = FakeModel([[tool('read_project', {}, 'read', prose='Checking the current circuit.')],
                       [tool('add_component', {'type': 'led'}, 'add')], [AIMessageChunk(content='Added LED.')]])
    events = collect(model, project_id='current', requirements={'behavior': 'steady'},
                     history=[HumanMessage(content='Build an LED circuit')])
    narration = [event['text'] for event in events if event.get('channel') == 'narration']
    assert 'Checking the current circuit.' in narration
    assert all(event['label'] in ('Read project', 'Add component') for event in events if event['type'] == 'step_start')
    assert model.tool_choices == ['required', 'required', 'auto']


def test_board_bootstrap_replans_batched_mutations_for_new_revision(service):
    service.board = 'unselected'
    service.result = {'id': 'current', 'revision': 5, 'board': 'pi-pico'}
    batched = AIMessageChunk(content='', tool_call_chunks=[
        {'name': 'read_project', 'args': '{}', 'id': 'read', 'index': 0},
        {'name': 'add_component', 'args': '{"type":"led","expected_revision":4}', 'id': 'led', 'index': 1},
    ])
    model = FakeModel([[batched], [AIMessageChunk(content='Board selected.')]])
    events = collect(model, project_id='current', requirements={'board': 'pi-pico'},
                     history=[HumanMessage(content='Build this circuit')])
    assert [call[1] for call in service.calls] == ['read_project', 'add_component']
    assert service.calls[-1][2]['type'] == 'pi-pico'
    feedback = [message for message in model.histories[1] if isinstance(message, ToolMessage)]
    assert {message.tool_call_id for message in feedback} >= {'read', 'led'}
    assert next(message for message in feedback if message.tool_call_id == 'led').status == 'error'
    assert events[-1]['status'] == 'success'


def test_confirmed_board_bootstrap_uses_real_hardware_service(tmp_path, monkeypatch):
    from backend.hardware import HardwareService
    hardware = HardwareService(data_dir=tmp_path)
    project = hardware.create_project(board='unselected')
    monkeypatch.setattr(agent, '_get_service', lambda: hardware)
    model = FakeModel([[tool('read_project', {}, 'read')], [AIMessageChunk(content='Arduino Nano selected.')]])
    events = collect(model, project_id=project['id'], requirements={'board': 'arduino-nano'},
                     history=[HumanMessage(content='Build this project')])
    updated = hardware.get_project(project['id'])
    assert updated['board'] == 'arduino-nano'
    assert updated['components'][0]['id'] == 'board'
    assert updated['components'][0]['type'] == 'arduino-nano'
    assert updated['revision'] == project['revision'] + 1
    assert events[-1]['changes']['componentsAdded'] == 1
    assert events[-1]['status'] == 'success'


def test_groq_quota_remains_an_explicit_blocker_without_mutation(service, monkeypatch):
    class QuotaError(Exception):
        status_code = 429

    delays = []

    async def no_wait(delay):
        delays.append(delay)

    monkeypatch.setattr(agent.asyncio, 'sleep', no_wait)
    model = FakeModel([[QuotaError('Quota exhausted')]])
    events = collect(model, project_id='current', requirements={'board': 'arduino-uno'},
                     history=[HumanMessage(content='Build this circuit')])
    assert len(delays) == 0
    assert service.calls == []
    assert events[-1]['status'] == 'error'
    assert 'Groq rate limit reached' in json.dumps(events)
