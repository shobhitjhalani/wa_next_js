import { describe, expect, it } from 'vitest';
import { normalizePhone, parsePhoneList, internationalise, fromWaId } from '@/lib/phone';
import { parseDate, parseDateRange, phpDate, addDays, hourIn, withinHours } from '@/lib/time';
import { decodeEntities, limit, numberFormat } from '@/lib/text';
import { legacyHash, checkPassword, hashPassword, needsUpgrade } from '@/lib/password';
import { ccaDecode, ccaDecrypt, ccaEncrypt } from '@/lib/ccavenue';
import { waToHtml } from '@/lib/whatsapp-text';
import { contactInitials, countVariables, messagePreview, messageStatusLabel, messageSummary, templateParameterCount, templateVariables } from '@/lib/format';

describe('phone (Support\\Phone)', () => {
  it('normalises home numbers to 10 digits and keeps international ones', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('0091 9876543210')).toBe('9876543210');
    expect(normalizePhone('971501234567')).toBe('971501234567');
    expect(normalizePhone('011-2345678')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });
  it('parses pasted lists into unique valid numbers + invalid entries', () => {
    expect(parsePhoneList('9876543210, 919876543210;abc\n9123456789')).toEqual([['9876543210', '9123456789'], ['abc']]);
  });
  it('adds / strips the country code for Meta', () => {
    expect(internationalise('9876543210')).toBe('919876543210');
    expect(internationalise('+971501234567')).toBe('971501234567');
    expect(fromWaId('919876543210')).toBe('9876543210');
    expect(fromWaId('971501234567')).toBe('971501234567');
  });
});

describe('time (PHP date / strtotime / DateRange)', () => {
  it('formats like PHP date()', () => {
    const ts = parseDate('07-10-2026 14:05')!;
    expect(phpDate('d-M-Y H:i:s', ts)).toBe('07-Oct-2026 14:05:00');
    expect(phpDate('ymd', ts)).toBe('261007');
    expect(phpDate('l, j F Y g:i A', ts)).toBe('Wednesday, 7 October 2026 2:05 PM');
    expect(phpDate('\\Y Y', ts)).toBe('Y 2026');
  });
  it('parses d-m-Y, Y-m-d and datetime-local, rejects invalid dates', () => {
    expect(parseDate('2026-10-07')).toBe(parseDate('07-10-2026'));
    expect(parseDate('2026-10-07T09:30')).toBe(parseDate('07-10-2026 09:30'));
    expect(parseDate('31-02-2026')).toBeNull();
    expect(parseDate('nonsense')).toBeNull();
  });
  it('parses flatpickr ranges with an exclusive end', () => {
    const [a, b] = parseDateRange('01-10-2026 to 07-10-2026')!;
    expect(a).toBe(parseDate('01-10-2026'));
    expect(b).toBe(addDays(parseDate('07-10-2026')!, 1));
    expect(parseDateRange('')).toBeNull();
  });
});

describe('text', () => {
  it('decodes HTML entities like html_entity_decode(ENT_QUOTES)', () => {
    expect(decodeEntities('Tom &amp; Jerry &#039;s &quot;x&quot; &#x1F44D;')).toBe('Tom & Jerry \'s "x" 👍');
  });
  it('limits like Str::limit and formats like number_format', () => {
    expect(limit('abcdef', 3, '')).toBe('abc');
    expect(limit('abc', 3)).toBe('abc');
    expect(numberFormat(1234567.4)).toBe('1,234,567');
  });
});

describe('password (LegacyPassword)', () => {
  it('accepts legacy sha1 hashes and flags them for upgrade', async () => {
    const stored = legacyHash('secret');
    expect(await checkPassword('secret', stored)).toBe(true);
    expect(await checkPassword('wrong', stored)).toBe(false);
    expect(needsUpgrade(stored)).toBe(true);
  });
  it('accepts PHP $2y$ bcrypt hashes', async () => {
    const hash = (await hashPassword('secret')).replace(/^\$2b\$/, '$2y$');
    expect(await checkPassword('secret', hash)).toBe(true);
    expect(needsUpgrade(hash)).toBe(false);
  });
});

describe('CCAvenue crypto', () => {
  it('round-trips and decodes key=value responses', () => {
    const enc = ccaEncrypt('order_id=PL-1&order_status=Success', 'workingkey123');
    expect(enc).toMatch(/^[0-9a-f]+$/);
    expect(ccaDecrypt(enc, 'workingkey123')).toBe('order_id=PL-1&order_status=Success');
    expect(ccaDecode(enc, 'workingkey123')).toEqual({ order_id: 'PL-1', order_status: 'Success' });
    expect(ccaDecrypt('zz', 'workingkey123')).toBe('');
  });
});

describe('WhatsApp text → HTML', () => {
  it('escapes, formats markers and links URLs without breaking snake_case', () => {
    expect(waToHtml('*bold* _it_ ~del~ <b>')).toBe('<strong>bold</strong> <em>it</em> <del>del</del> &lt;b&gt;');
    expect(waToHtml('see https://a.test/x_y_z.')).toBe('see <a href="https://a.test/x_y_z" target="_blank" rel="noopener">https://a.test/x_y_z</a>.');
    expect(waToHtml('snake_case_name')).toBe('snake_case_name');
    expect(waToHtml('got *₹1* for *1* booking dated *4-11-2026*.')).toBe('got <strong>₹1</strong> for <strong>1</strong> booking dated <strong>4-11-2026</strong>.');
  });
});

describe('row formatting (model accessors)', () => {
  it('summarises and previews messages', () => {
    expect(messageSummary({ m_content: '', m_msg_template_name: 'promo', m_msg_template_para: 'a,b' })).toBe('Template : promo : a,b');
    expect(messagePreview({ m_is_incoming: 1, m_msg_type: 'image', m_image: '{"caption":"hi"}' })).toBe('📷 Photo hi');
    expect(messagePreview({ m_is_incoming: 1, m_msg_type: 'reaction', m_image: '{"emoji":"ud83dudc4d"}' })).toBe('Reacted 👍');
  });
  it('labels statuses like the legacy reports', () => {
    expect(messageStatusLabel({ m_status: 1 })).toBe('In Que');
    expect(messageStatusLabel({ m_status: 3, m_message_id: 'wamid.1', m_delivery_status: 'read' })).toBe('read');
    expect(messageStatusLabel({ m_status: 3, m_message_id: '', m_status_response: '[{"error":{"message":"Bad number"}}]' })).toBe('Bad number');
  });
  it('counts template variables', () => {
    expect(templateVariables('Hi {{2}} and {{1}} {{ 1 }}')).toEqual([1, 2]);
    expect(countVariables('Hi {{1}} {{2}} {{1}}')).toBe(2);
    expect(templateParameterCount({ ut_parameters: '{"body_text":[["a","b","c"]]}', ut_message: '{{1}}' })).toBe(3);
  });
  it('builds contact initials', () => {
    expect(contactInitials({ cl_name: 'ravi kumar sharma', cl_mobile_no: '9876543210' })).toBe('RK');
    expect(contactInitials({ cl_name: null, cl_mobile_no: '9876543210' })).toBe('10');
  });
});

describe('campaign sending window (07:00–23:00 IST)', () => {
  const ist = (hm: string) => new Date(`2026-11-05T${hm}:00+05:30`);
  it('reads the hour in the app time zone, not the process one', () => {
    expect(hourIn(ist('00:30'), 'Asia/Kolkata')).toBe(0);
    expect(hourIn(ist('23:59'), 'Asia/Kolkata')).toBe(23);
    expect(hourIn(ist('07:00'), 'UTC')).toBe(1);
  });
  it('opens at 07:00 and closes at 23:00', () => {
    const open = (hm: string) => withinHours(ist(hm), 7, 23, 'Asia/Kolkata');
    expect(open('06:59')).toBe(false);
    expect(open('07:00')).toBe(true);
    expect(open('22:59')).toBe(true);
    expect(open('23:00')).toBe(false);
    expect(open('00:06')).toBe(false);
  });
});
