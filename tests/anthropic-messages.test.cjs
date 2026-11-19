const assert = require('node:assert/strict');
const { test } = require('node:test');
const esbuild = require('esbuild');

async function load() {
  const b = await esbuild.build({ entryPoints: ['src/lib/anthropic-messages.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('a Messages body becomes the chat-completions body: system, tool_use, tool_result, tools and tool_choice', async () => {
  const { toChatBody } = await load();
  const body = toChatBody({
    model: 'llama-4-scout', max_tokens: 300, system: [{ type: 'text', text: 'Be brief.' }],
    messages: [
      { role: 'user', content: 'Weather in Stockholm?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Stockholm' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"tempC":7}' }, { type: 'text', text: 'And tomorrow?' }] },
    ],
    tools: [{ name: 'get_weather', description: 'Weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
    tool_choice: { type: 'any' },
  });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Weather in Stockholm?' },
    { role: 'assistant', content: 'Checking.', tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Stockholm"}' } }] },
    { role: 'tool', tool_call_id: 'toolu_1', content: '{"tempC":7}' },
    { role: 'user', content: 'And tomorrow?' },
  ]);
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }]);
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.max_tokens, 300);
});

test('a chat completion becomes a Messages answer and a Messages event stream', async () => {
  const { toMessagesAnswer, toMessagesStream } = await load();
  const completion = { id: 'chatcmpl-abc123', object: 'chat.completion', created: 1, model: 'm', usage: { prompt_tokens: 50, completion_tokens: 9, total_tokens: 59, estimated: false },
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: 'Let me check.', tool_calls: [{ id: 'chatcmpl-tool-9', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Stockholm"}' } }] } }] };
  const answer = toMessagesAnswer(completion);
  assert.equal(answer.type, 'message');
  assert.equal(answer.stop_reason, 'tool_use');
  assert.deepEqual(answer.content[0], { type: 'text', text: 'Let me check.' });
  assert.equal(answer.content[1].type, 'tool_use');
  assert.match(answer.content[1].id, /^toolu_/);
  assert.deepEqual(answer.content[1].input, { city: 'Stockholm' });
  assert.deepEqual(answer.usage, { input_tokens: 50, output_tokens: 9 });
  const events = toMessagesStream(answer).trim().split('\n\n').map((e) => e.split('\n')[0].replace('event: ', ''));
  assert.deepEqual(events, ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  const plain = toMessagesAnswer({ ...completion, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hi' } }] });
  assert.equal(plain.stop_reason, 'end_turn');
  assert.deepEqual(plain.content, [{ type: 'text', text: 'Hi' }]);
});

test('Anthropic SDK setup surfaces are served: an Anthropic model list and a local token estimate', async () => {
  const { anthropicModels, countTokens, ANTHROPIC_COUNT_TOKENS_PATH } = await load();
  const models = anthropicModels();
  assert.equal(models.has_more, false, 'Anthropic envelope');
  assert.ok(Array.isArray(models.data) && models.data.length > 0);
  assert.equal(models.first_id, models.data[0].id);
  assert.equal(models.last_id, models.data[models.data.length - 1].id);
  for (const m of models.data) {
    assert.equal(m.type, 'model');
    assert.ok(m.id && m.display_name && m.created_at, `${m.id}: a full model object`);
    assert.ok(!/claude/i.test(m.id), `${m.id}: no Claude model is claimed`);
  }
  const c = countTokens({ model: 'llama-4-scout', messages: [{ role: 'user', content: 'Hello world, this is a test.' }] });
  assert.ok(c.input_tokens > 0 && Number.isInteger(c.input_tokens));
  assert.match(c.note, /estimate/i, 'the token count is stated to be local, not Anthropic-exact');
  assert.equal(ANTHROPIC_COUNT_TOKENS_PATH, '/v1/messages/count_tokens');
});
