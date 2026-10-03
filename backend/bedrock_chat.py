from langchain_aws import ChatBedrockConverse


class WireUpBedrockConverse(ChatBedrockConverse):
    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        # Converse calls forced tool selection "any", not "required".
        if tool_choice == 'required':
            tool_choice = 'any'
        return super().bind_tools(tools, tool_choice=tool_choice, **kwargs)
