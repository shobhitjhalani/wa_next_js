import { describe, expect, it } from 'vitest';
import { checkAnswer, checkInput, flowVariables, roundRobinNext, parseAnswerDate, outputs, parseKeywords, parseMap, sanitizeGraph, starterGraph, validateGraph } from '@/lib/bot-flow';

describe('chatbot flow graph', () => {
  it('keeps a valid starter flow except for the missing keyword', () => {
    const g = sanitizeGraph(starterGraph());
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(validateGraph(g)).toEqual(['Add at least one trigger keyword.']);
  });

  it('parses keywords lower-cased, trimmed and unique', () => {
    expect(parseKeywords(' Hi, hello\nHI ,, Menu ')).toEqual(['hi', 'hello', 'menu']);
  });

  it('drops unknown nodes, edges to missing handles, edges into the trigger and second edges from one output', () => {
    const g = sanitizeGraph({
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { keywords: 'hi' } },
        { id: 'b', type: 'buttons', position: { x: 1, y: 0 }, data: { text: 'Pick', buttons: ['A', 'B', 'C', 'D'], saveAs: 'My Choice!' } },
        { id: 'x', type: 'evil', position: { x: 2, y: 0 }, data: {} },
        { id: 'm', type: 'message', position: { x: 3, y: 0 }, data: { text: 'ok' } },
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'b' },
        { id: '2', source: 'b', sourceHandle: 'o0', target: 'm' },
        { id: '3', source: 'b', sourceHandle: 'o0', target: 'm' },      // same output twice
        { id: '4', source: 'b', sourceHandle: 'o9', target: 'm' },      // no such button
        { id: '5', source: 'm', target: 'trigger' },                    // into the trigger
        { id: '6', source: 'b', sourceHandle: 'o1', target: 'x' },      // unknown node
      ],
    });
    expect(g.nodes.map((n) => n.id)).toEqual(['trigger', 'b', 'm']);
    expect((g.nodes[1].data as { buttons: string[] }).buttons).toHaveLength(3); // WhatsApp allows 3
    expect((g.nodes[1].data as { saveAs: string }).saveAs).toBe('my_choice_');
    expect(g.edges.map((e) => e.id)).toEqual(['1', '2']);
    expect(outputs(g.nodes[1]).map((o) => o.id)).toEqual(['o0', 'o1', 'o2']);
    expect(validateGraph(g)).toEqual([]);
    expect(flowVariables(g)).toEqual(['my_choice_']);
  });

  it('reports unconnected steps and missing fields', () => {
    const g = sanitizeGraph({
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { keywords: 'hi' } },
        { id: 'a', type: 'ask', position: { x: 1, y: 0 }, data: { text: '', saveAs: '' } },
        { id: 'w', type: 'webhook', position: { x: 2, y: 0 }, data: { url: 'ftp://x' } },
      ],
      edges: [{ id: '1', source: 'trigger', target: 'a' }],
    });
    const problems = validateGraph(g);
    expect(problems).toContain('Ask question: enter the question.');
    expect(problems).toContain('Ask question: enter a variable name to save the answer in.');
    expect(problems).toContain('Webhook: enter a URL starting with https://.');
    expect(problems).toContain('Webhook is not connected to anything before it.');
  });

  it('parses webhook response mappings', () => {
    expect(parseMap('status = data.status\n bad line \nAgent=data.agents.0.name')).toEqual([['status', 'data.status'], ['agent', 'data.agents.0.name']]);
  });

  it('accepts dates in common formats and saves them as DD-MM-YYYY', () => {
    for (const v of ['25-12-2026', '25/12/2026', '25.12.2026', '25-12-26', '2026-12-25', '25 Dec 2026', '25th December, 2026', 'Dec 25, 2026', '5/1/2026'])
      expect(parseAnswerDate(v), v).toBe(v === '5/1/2026' ? '05-01-2026' : '25-12-2026');
    for (const v of ['31-02-2026', '29-02-2027', '00-01-2026', '12-13-2026', 'tomorrow', '2026', '25 Foo 2026'])
      expect(parseAnswerDate(v), v).toBeNull();
    expect(parseAnswerDate('29-02-2028')).toBe('29-02-2028');
  });

  it('checks answers by type', () => {
    expect(checkAnswer('date', ' 1 jan 2027 ')).toBe('01-01-2027');
    expect(checkAnswer('number', '1,250.5')).toBe('1,250.5');
    expect(checkAnswer('number', 'ten')).toBeNull();
    expect(checkAnswer('email', 'a@b.co')).toBe('a@b.co');
    expect(checkAnswer('phone', '+91 98290 12345')).toBe('+91 98290 12345');
    expect(checkAnswer('any', '  ')).toBeNull();
  });

  it('checks User input answers: name, 10-digit mobile, date, any', () => {
    expect(checkInput('name', '  Ravi   Kumar ')).toBe('Ravi Kumar');
    expect(checkInput('name', "D'Souza-Pai")).toBe("D'Souza-Pai");
    expect(checkInput('name', 'रवि कुमार')).toBe('रवि कुमार');
    for (const v of ['R', 'Ravi 2', '12345', '@ravi', '']) expect(checkInput('name', v), v).toBeNull();
    for (const v of ['9876543210', '98765 43210', '98765-43210', '+91 98765 43210', '919876543210', '09876543210'])
      expect(checkInput('mobile', v), v).toBe('9876543210');
    for (const v of ['987654321', '98765432101', '+1 9876543210', 'ninety', '98765abc10']) expect(checkInput('mobile', v), v).toBeNull();
    expect(checkInput('date', '25 Dec 2026')).toBe('25-12-2026');
    expect(checkInput('date', '31-02-2026')).toBeNull();
    expect(checkInput('any', ' hello  there ')).toBe('hello  there');
    expect(checkInput('any', '   ')).toBeNull();
  });

  it('keeps User input and Assign to team steps and lists their variables', () => {
    const g = sanitizeGraph({
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { keywords: 'hi' } },
        { id: 'i', type: 'input', position: { x: 1, y: 0 }, data: { text: 'Your name?', field: 'bogus', saveAs: 'Customer Name' } },
        { id: 'a', type: 'assign', position: { x: 2, y: 0 }, data: { members: [3, '3', -1, 'x', 7], crm: 'yes' } },
      ],
      edges: [{ id: '1', source: 'trigger', target: 'i' }, { id: '2', source: 'i', target: 'a' }],
    });
    expect(g.nodes[1].data).toEqual({ text: 'Your name?', field: 'any', saveAs: 'customer_name', error: '' });
    expect(g.nodes[2].data).toEqual({ members: [3, 7], keep: true, crm: false });
    expect(flowVariables(g)).toEqual(['customer_name', 'assigned_to']);
    expect(validateGraph(g)).toEqual([]);
    expect(validateGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'i' ? { ...n, data: { ...n.data, text: '' } } : n)) as typeof g.nodes }))
      .toEqual(['User input: enter the message that asks the customer.']);
  });

  it('takes team members in turn (round robin)', () => {
    expect(roundRobinNext([5, 2, 9], 0)).toBe(2);
    expect(roundRobinNext([5, 2, 9], 2)).toBe(5);
    expect(roundRobinNext([5, 2, 9], 5)).toBe(9);
    expect(roundRobinNext([5, 2, 9], 9)).toBe(2);
    expect(roundRobinNext([5, 2, 9], 6)).toBe(9); // the last member left the rotation
    expect(roundRobinNext([4], 4)).toBe(4);
  });
});
