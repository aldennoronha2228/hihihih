import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.WIREUP_AUDIT_URL || 'http://127.0.0.1:5173';
const suffix = process.env.WIREUP_AUDIT_SUFFIX || '';
const out = 'audit-artifacts/release-project-audit' + (suffix ? '-' + suffix : '');
fs.mkdirSync(out, { recursive: true });
const matrix = [
 ['uno-led','arduino-uno','External LED blink with a 220 ohm resistor, one second on and one second off.'],
 ['nano-button','arduino-nano','A pushbutton controls an external LED with a 220 ohm resistor. Use INPUT_PULLUP and active-low button.'],
 ['mega-rgb','arduino-mega','A common-cathode RGB LED with three 220 ohm resistors cycles red, green and blue.'],
 ['uno-servo','arduino-uno','A servo sweeps 0 to 90 to 180 degrees.'],
 ['nano-ultrasonic','arduino-nano','An HC-SR04 distance monitor prints centimeters on the serial monitor.'],
 ['mega-pot','arduino-mega','A rotary potentiometer on A15 controls an external LED brightness through a resistor.'],
 ['pico-pot','pi-pico','A rotary potentiometer on GP26 is read by analogRead(A0) and printed using Serial1 UART. Use 3.3V.'],
 ['pico-w-led','pi-pico-w','An external LED with a 220 ohm resistor blinks on GP2. Use Serial1 UART. Do not use wireless or the CYW43 onboard LED.'],
 ['c3-led','esp32-c3','An external LED and 220 ohm resistor blink on GPIO2 with UART0 messages. No USB CDC.'],
 ['s3-button','esp32-s3','A ground-connected INPUT_PULLUP pushbutton on GPIO4 toggles an external LED through a resistor on GPIO5. Use UART0.'],
 ['classic-v1','esp32-devkit-v1','An external LED and 220 ohm resistor blink on GPIO2 with Serial messages.'],
 ['classic-cv4','esp32-devkit-c-v4','A simple rotary potentiometer voltage monitor with analogRead and Serial.'],
 ['uno-dht','arduino-uno','A DHT22 temperature and humidity monitor uses the installed Adafruit DHT library and Serial.'],
 ['uno-oled','arduino-uno','A four-pin SSD1306 I2C OLED shows Hello WireUp using the installed Adafruit library.'],
 ['uno-lcd','arduino-uno','A 16x2 I2C LCD displays Hello WireUp using LiquidCrystal_I2C.'],
 ['uno-rtc','arduino-uno','A DS1307 clock prints actual register time using Wire.'],
 ['uno-mpu','arduino-uno','An MPU6050 prints its WHO_AM_I register and acceleration data using Wire.'],
 ['uno-bmp','arduino-uno','A BMP280 prints temperature and pressure using the installed Adafruit BMP280 library. Use 3.3V.'],
 ['uno-switches','arduino-uno','A ground-connected DIP switch two-channel input and a KY-040 rotary encoder report switch states and rotation with serial.'],
 ['uno-mixed','arduino-uno','A photoresistor sensor, NTC temperature sensor and analog joystick are read on distinct analog pins and printed over Serial.'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const probes = [];
const results = [];
const selectedCases = process.env.WIREUP_AUDIT_CASES?.split(',').filter(Boolean);
const activeMatrix = selectedCases ? matrix.filter(([id]) => selectedCases.includes(id)) : matrix;

async function chat(page, payload, timeout = 310000) {
 await page.waitForTimeout(600);
 const events = await page.evaluate(async ({ payload, timeout }) => {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), timeout);
  const events = []; let text = '';
  try {
   const response = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:abort.signal });
   if(!response.ok) return { http_status:response.status, error:await response.text(), events:[] };
   const reader=response.body.getReader(); const decoder=new TextDecoder();
   while(true){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});const lines=text.split('\n');text=lines.pop()||'';for(const line of lines)if(line.trim())events.push(JSON.parse(line));}
   return {http_status:response.status,events};
  } catch(error) { return {error:String(error),events}; }
  finally {clearTimeout(timer);}
 }, {payload,timeout});
 return events;
}
function answerText(turn) {return (turn.events||[]).filter(e=>e.type==='text'&&e.channel==='answer').map(e=>e.text).join('');}
function final(turn) {return (turn.events||[]).findLast(e=>e.type==='done')||{};}
function safe(value) {return JSON.parse(JSON.stringify(value,(key,item)=> key==='runtime_token'||key==='token'||key==='bin'||key==='hex'||key==='payload' ? '[omitted]' : item));}
function checkpoint() {
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({probes,projects:results},null,2));
 const lines=['# WireUp live 20-project release audit','',`Attempts completed: ${results.length}/20. Each project starts from a new board-only project; no example/template source is inserted by the test.`,`Models are real configured providers. The test selects AI-choice answers while retaining the exact requested board. Simulator execution is independently exercised in the actual mounted browser.`,`This matrix samples component families; it is not exhaustive testing of every catalog component.`, '', '## Provider chat probes','| Provider | HTTP | Final status | Response |','|---|---:|---|---|',...probes.map(p=>`| ${p.provider} | ${p.http_status||''} | ${p.status||'no completion'} | ${(p.reply||p.error||'').replace(/\|/g,'/').replace(/\n/g,' ').slice(0,220)} |`),'','## Fresh project attempts','| Project | Board | AI final | Parts / wires | Compile | Simulation |','|---|---|---|---|---|---|',...results.map(r=>`| ${r.id} | ${r.board} | ${r.ai_status||'failed before build'} | ${r.component_count??0} / ${r.wire_count??0} | ${r.compile_status||'not completed'} | ${r.simulation?.status||'not run'} |`),'','## Findings',...results.filter(r=>r.error||r.ai_status!=='success'||r.simulation?.status!=='verified_run').map(r=>`- **${r.id}**: ${(r.error||r.ai_reason||r.simulation?.error||r.simulation?.status||'incomplete').replace(/\n/g,' ').slice(0,600)}`),'','## Evidence boundaries','A successful process start or firmware compile is not proof the design is electrically safe or functionally correct. No physical board was flashed. Serial output is recorded, not invented. Provider key/credentials and compiled binary payloads are excluded from this report. Detailed per-project activity, actual source and topology are recorded in the JSON artifact.'];
 fs.writeFileSync(`docs/RELEASE_20_PROJECT_REPORT${suffix ? '-' + suffix : ''}.md`,lines.join('\n')+'\n');
}
try {
 const probePage=await browser.newPage();await probePage.goto(root);
 const health=await (await probePage.request.get(root+'/api/health')).json();
 for(const provider of (process.env.WIREUP_AUDIT_PROVIDER ? (health.providers||[]).filter(p=>p.id===process.env.WIREUP_AUDIT_PROVIDER) : health.providers||[])){
  if(!provider.configured){probes.push({provider:provider.id,status:'not configured'});checkpoint();continue;}
  const turn=await chat(probePage,{provider:provider.id,messages:[{role:'user',content:'Reply in one sentence: Hello from WireUp release testing.'}]},provider.id==='bedrock'?310000:90000);
  probes.push({provider:provider.id,model:provider.model,http_status:turn.http_status,status:final(turn).status,reply:answerText(turn),error:turn.error||(!answerText(turn)?(turn.events||[]).filter(e=>e.type==='text').map(e=>e.text).join(''):undefined)});checkpoint();
 }
 await probePage.close();
 const provider=probes.find(p=>p.provider==='azure'&&p.status==='success')?.provider||probes.find(p=>p.status==='success')?.provider;
 if(!provider)throw new Error('No live chat provider succeeded; all 20 builds are blocked by provider readiness.');
 for(const [id,board,description] of activeMatrix){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const result={id,board,provider,request:description,started_at:new Date().toISOString()};
  try {
   const create=await page.request.post(root+'/api/hardware/projects',{data:{name:`Release audit ${id}`,board}});
   if(!create.ok())throw new Error(`Create ${create.status()}: ${await create.text()}`);
   const project=await create.json();result.project_id=project.id;
   await page.goto(root+'/project/'+project.id);
   await page.getByText('Runtime: Connected',{exact:true}).waitFor({timeout:30000});
   const prompt=`Build this fresh ${board} project: ${description} Use this existing board; do not replace it. Add actual components, real complete connections and actual firmware. Compile if the target supports compilation. Do not run simulation yet; the tester will run it after compiling. Use supported components, read actual tool results, and explain limitations.`;
   const first=await chat(page,{provider,messages:[{role:'user',content:prompt}],project_id:project.id,runtime_token:project.runtime_token});result.question_turn=safe(first);
   const questions=(first.events||[]).find(e=>e.type==='questions');
   if(!questions)throw new Error('No setup questions returned: '+JSON.stringify(final(first))+' '+(first.error||''));
   const answers=Object.fromEntries(questions.questions.map(q=>[q.id,q.id==='board'?board:'ai_choose']));result.answers=answers;
   const summary=questions.questions.map(q=>`${q.question}: ${q.id==='board'?board:'Let AI choose a compatible option.'}`).join('; ');
   const second=await chat(page,{provider,project_id:project.id,runtime_token:project.runtime_token,project_answers:answers,messages:[{role:'user',content:prompt},{role:'assistant',content:questions.summary||'Project-specific questions prepared.'},{role:'user',content:'Project requirements confirmed: '+summary}]});
   result.build_turn=safe(second);result.ai_status=final(second).status;result.ai_reason=final(second).reason;
   let state=await (await page.request.get(root+'/api/hardware/projects/'+project.id)).json();
   result.component_count=state.components.length;result.wire_count=state.wires.length;result.source=state.firmware.source;result.components=state.components;result.wires=state.wires;
   result.compile_status=state.compiler?.status||'not compiled';result.compiler=safe(state.compiler);
   if(!state.firmware.source.trim()||state.components.length<2)result.error='AI did not generate requested source/parts.';
   const artifact=state.compiler?.artifact;
   if(artifact&&!state.compiler.stale){
    await page.reload();await page.getByText('Runtime: Connected',{exact:true}).waitFor({timeout:30000});
    const run=page.getByRole('button',{name:'Run',exact:true});
    if(await run.isEnabled()){
     await run.click();await page.getByRole('button',{name:'Stop',exact:true}).waitFor({timeout:45000});
     await page.getByRole('button',{name:'Serial monitor',exact:true}).click();await page.waitForTimeout(3500);
     result.simulation={status:'verified_run',serial:await page.getByLabel('Serial output',{exact:true}).innerText(),alerts:await page.getByRole('alert').allTextContents()};
     await page.getByRole('button',{name:'Stop',exact:true}).click();
    }else result.simulation={status:'unavailable',error:await run.getAttribute('title')};
   }else result.simulation={status:'not_run_no_current_artifact'};
   await page.screenshot({path:path.join(out,id+'.png')});result.page_errors=errors;
   if(errors.length)result.error='Browser errors: '+errors.join(';');
  } catch(error){result.error=String(error);try{result.last_screen=(await page.locator('body').innerText()).slice(-4000);}catch{} }
  finally {result.finished_at=new Date().toISOString();results.push(result);checkpoint();await page.close();console.log(`CASE ${results.length}/20 ${id}: AI=${result.ai_status||'failed'} compile=${result.compile_status||'none'} sim=${result.simulation?.status||'none'}`);}
 }
 console.log('DONE: 20 live project attempts recorded in docs/RELEASE_20_PROJECT_REPORT.md and test-results/release-project-audit/results.json');
} catch(error){fs.writeFileSync(path.join(out,'fatal.txt'),String(error));checkpoint();console.log('FAILED',String(error));process.exitCode=1;} finally {await browser.close();}
