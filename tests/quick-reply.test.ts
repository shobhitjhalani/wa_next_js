import { describe, expect, it } from 'vitest';
import { fillVars, keywordMatches, pickReply, qrKeywords, sanitizeData, validateReply } from '../src/lib/quick-reply';

describe('keywordMatches', () => {
  it('is exactly: whole message, any case and spacing', () => {
    expect(keywordMatches('  PRICE ', 'price', 1)).toBe(true);
    expect(keywordMatches('price list', 'price', 1)).toBe(false);
    expect(keywordMatches('price  list', 'price list', 1)).toBe(true);
  });
  it('contains: whole words only', () => {
    expect(keywordMatches('What is the price?', 'price', 2)).toBe(true);
    expect(keywordMatches('this is it', 'hi', 2)).toBe(false);
    expect(keywordMatches('hi there', 'hi', 2)).toBe(true);
    expect(keywordMatches('send the price list please', 'price list', 2)).toBe(true);
  });
  it('starts with / ends with', () => {
    expect(keywordMatches('Price of Swift', 'price', 3)).toBe(true);
    expect(keywordMatches('the price', 'price', 3)).toBe(false);
    expect(keywordMatches('pricey car', 'price', 3)).toBe(false);
    expect(keywordMatches('tell me the price', 'price', 4)).toBe(true);
    expect(keywordMatches('price please', 'price', 4)).toBe(false);
    expect(keywordMatches('नमस्ते जी', 'नमस्ते', 3)).toBe(true);
  });
  it('regex characters in keywords are literal', () => {
    expect(keywordMatches('what is c++ ?', 'c++', 2)).toBe(true);
    expect(keywordMatches('a.b', 'a*b', 1)).toBe(false);
  });
});

describe('pickReply', () => {
  const list = [
    { id: 1, keywords: ['price'], match: 2 },
    { id: 2, keywords: ['price'], match: 1 },
    { id: 3, keywords: ['price list'], match: 2 },
    { id: 4, keywords: ['hello'], match: 3 },
  ];
  it('exact beats starts beats contains; longer keyword wins', () => {
    expect(pickReply(list, 'price')?.id).toBe(2);
    expect(pickReply(list, 'send price list')?.id).toBe(3);
    expect(pickReply(list, 'what price?')?.id).toBe(1);
    expect(pickReply(list, 'hello, price?')?.id).toBe(4);
    expect(pickReply(list, 'nothing here')).toBeNull();
  });
  it('newest wins a tie', () => {
    expect(pickReply([{ id: 5, keywords: ['hi'], match: 1 }, { id: 9, keywords: ['hi'], match: 1 }], 'Hi')?.id).toBe(9);
  });
});

describe('validation', () => {
  it('needs content per type', () => {
    const base = { name: 'x', keywords: qrKeywords('a, B'), type: 'text' as const };
    expect(base.keywords).toEqual(['a', 'b']);
    expect(validateReply({ ...base, data: sanitizeData('text', { text: '' }) }).text).toBeTruthy();
    expect(validateReply({ ...base, type: 'media', data: sanitizeData('media', { media: '' }) }).media).toBeTruthy();
    expect(validateReply({ ...base, type: 'media', data: sanitizeData('media', { media: 'https://x.com/a.jpg' }) })).toEqual({});
    expect(validateReply({ ...base, type: 'buttons', data: sanitizeData('buttons', { text: 't', buttons: ['Yes', 'yes'] }) }).buttons).toBeTruthy();
    expect(validateReply({ ...base, type: 'buttons', data: sanitizeData('buttons', { text: 't', media: 'https://x.com/a.mp3', buttons: ['Yes'] }) }).media).toBeTruthy();
    expect(validateReply({ ...base, type: 'list', data: sanitizeData('list', { text: 't', listLabel: 'Menu', rows: [{ title: 'A' }, { title: 'B' }] }) })).toEqual({});
    expect(sanitizeData('buttons', { buttons: ['1', '2', '3', '4'] }).buttons).toHaveLength(3);
  });
  it('fills variables', () => {
    expect(fillVars('Hi {{name}} ({{ mobile }}) {{other}}', { name: 'Ravi', mobile: '91' })).toBe('Hi Ravi (91) {{other}}');
  });
});
