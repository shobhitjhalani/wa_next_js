/**
 * Postman collection (v2.1) for REST API v2. The API page serves it with the
 * account's base URL and key filled in; docs/WA-API-v2.postman_collection.json
 * is the same collection with placeholders (npm run -s postman:export).
 */

type Json = Record<string, unknown>;

const SAVE_ID = [
  'const j = pm.response.json();',
  'pm.test("success", () => pm.expect(j.success).to.eql(true));',
  'if (j.success && j.data && j.data.messages && j.data.messages[0]) {',
  '  pm.collectionVariables.set("message_id", j.data.messages[0].id);',
  '}',
];
const CHECK = ['const j = pm.response.json();', 'pm.test("success", () => pm.expect(j.success).to.eql(true));'];

const test = (exec: string[]) => [{ listen: 'test', script: { type: 'text/javascript', exec } }];

function url(path: string, query: [string, string, string, boolean?][] = []): Json {
  const q = query.map(([key, value, description, disabled]) => ({ key, value, description, ...(disabled ? { disabled: true } : {}) }));
  const active = q.filter((p) => !p.disabled).map((p) => `${p.key}=${p.value}`).join('&');
  return {
    raw: `{{base_url}}/${path}${active ? '?' + active : ''}`,
    host: ['{{base_url}}'],
    path: path.split('/'),
    ...(q.length ? { query: q } : {}),
  };
}

function jsonRequest(name: string, path: string, body: unknown, description: string, events = SAVE_ID): Json {
  return {
    name,
    event: test(events),
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      url: url(path),
      body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } },
      description,
    },
  };
}

type FormField = [key: string, value: string, type?: 'text' | 'file', description?: string];

function formRequest(name: string, path: string, fields: FormField[], description: string, events = SAVE_ID): Json {
  return {
    name,
    event: test(events),
    request: {
      method: 'POST',
      header: [],
      url: url(path),
      body: {
        mode: 'formdata',
        formdata: fields.map(([key, value, type = 'text', desc]) => (type === 'file'
          ? { key, type: 'file', src: [], description: desc ?? 'Choose a file' }
          : { key, value, type: 'text', ...(desc ? { description: desc } : {}) })),
      },
      description,
    },
  };
}

export function postmanCollection(baseUrl: string, apiKey: string): Json {
  return {
    info: {
      name: 'WhatsApp API v2',
      _postman_id: '6b0f2c3e-6a7d-4b8e-9d2a-0c1f5e7a9b31',
      description: [
        'Send WhatsApp templates, text and attachments, check message status, and list / create templates.',
        '',
        'Set the collection variables before sending:',
        '- base_url: your API base URL',
        '- api_key: your API key (Profile → API Access Key); it is sent in the X-API-Key header',
        '- to: a test mobile number with country code, e.g. 919876543210',
        '',
        'Responses are {"success": true, "data": …} or {"success": false, "error": {"code", "message", "field"}}.',
        'Text and attachment messages need the customer to have written to you in the last 24 hours.',
        'Sending a message saves its id in the message_id variable for "Message status".',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'apikey',
      apikey: [
        { key: 'key', value: 'X-API-Key', type: 'string' },
        { key: 'value', value: '{{api_key}}', type: 'string' },
        { key: 'in', value: 'header', type: 'string' },
      ],
    },
    variable: [
      { key: 'base_url', value: baseUrl, type: 'string' },
      { key: 'api_key', value: apiKey, type: 'string' },
      { key: 'to', value: '919876543210', type: 'string' },
      { key: 'template', value: 'order_update', type: 'string' },
      { key: 'message_id', value: '', type: 'string' },
    ],
    item: [
      {
        name: 'Templates',
        item: [
          {
            name: 'List templates',
            event: test(CHECK),
            request: {
              method: 'GET',
              header: [],
              url: url('templates', [
                ['sync', '1', '1 = fetch the latest templates from WhatsApp first', true],
                ['status', 'approved', 'approved (default) or all', true],
                ['name', '{{template}}', 'only this template', true],
                ['category', 'UTILITY', 'MARKETING, UTILITY or AUTHENTICATION', true],
              ]),
              description: 'Approved templates with body_parameters, header, buttons (dynamic URL buttons and their index), cards and can_send. Enable the query parameters you need.',
            },
          },
          jsonRequest('Create template (text header, URL button)', 'templates', {
            name: 'order_update',
            category: 'UTILITY',
            language: 'en',
            header_type: 'TEXT',
            header_text: 'Order update',
            body: 'Hi {{1}}, your order {{2}} has been shipped.',
            body_examples: ['Ravi', 'ORD-1001'],
            footer: 'Reply STOP to opt out',
            buttons: [
              { type: 'URL', text: 'Track order', url: 'https://example.com/track/{{1}}', example: 'https://example.com/track/ORD-1001' },
              { type: 'QUICK_REPLY', text: 'Talk to us' },
            ],
          }, 'Submits a standard template to WhatsApp for review. It can be sent once approved (List templates with sync=1). category: MARKETING or UTILITY. header_type: NONE, TEXT, IMAGE, VIDEO or DOCUMENT. Buttons: QUICK_REPLY {text}, URL {text, url, example}, PHONE_NUMBER {text, phone}.', CHECK),
          formRequest('Create template (image header)', 'templates', [
            ['name', 'festive_offer'],
            ['category', 'MARKETING'],
            ['language', 'en'],
            ['header_type', 'IMAGE'],
            ['header_file', '', 'file', 'Sample image (.jpg / .png, up to 5 MB)'],
            ['body', 'Hi {{1}}, our festive offer is live! Visit us today.'],
            ['body_examples', '["Ravi"]', 'text', 'JSON array, one sample per body variable'],
            ['buttons', '[{"type":"QUICK_REPLY","text":"Interested"}]', 'text', 'JSON array (optional)'],
          ], 'Media headers need a sample file, so this request is multipart/form-data. List fields are sent as JSON strings.', CHECK),
        ],
      },
      {
        name: 'Send messages',
        item: [
          jsonRequest('Send template', 'messages/template', {
            to: '{{to}}',
            template: '{{template}}',
            parameters: ['Ravi', 'ORD-1001'],
          }, 'parameters: body values for {{1}}, {{2}}, … in order. to may also be an array or comma-separated list (up to 100 numbers; then the response is 202 and messages are sent in the background).'),
          jsonRequest('Send template (media header + URL button)', 'messages/template', {
            to: '{{to}}',
            template: '{{template}}',
            language: 'en',
            parameters: ['Ravi', 'ORD-1001'],
            header_url: 'https://example.com/invoice.pdf',
            header_parameter: 'Ravi',
            button_parameters: { 0: 'ORD-1001' },
          }, 'header_url: for image / video / document templates (public URL ending in .jpg/.png, .mp4 or .pdf). header_parameter: value for {{1}} in a text header. button_parameters: dynamic URL button values by button index. Remove the fields your template does not use.'),
          formRequest('Send template (upload header file)', 'messages/template', [
            ['to', '{{to}}'],
            ['template', '{{template}}'],
            ['parameters[]', 'Ravi', 'text', '{{1}}'],
            ['parameters[]', 'ORD-1001', 'text', '{{2}}'],
            ['header_file', '', 'file', 'Header image / video / document'],
          ], 'Uploads the header media instead of a URL. Repeat parameters[] for each body value.'),
          jsonRequest('Send carousel template', 'messages/template', {
            to: '{{to}}',
            template: 'product_carousel',
            parameters: ['Ravi'],
            cards: [
              { media_url: 'https://example.com/car-1.jpg', parameters: ['Nexon'], button_parameters: { 0: 'nexon' } },
              { media_url: 'https://example.com/car-2.jpg', parameters: ['Punch'], button_parameters: { 0: 'punch' } },
            ],
          }, 'One entry in cards per card of the template: media_url (.jpg/.png, or .mp4 for video cards), parameters for the card body, button_parameters for dynamic URL buttons.'),
          jsonRequest('Send text', 'messages/text', {
            to: '{{to}}',
            text: 'Hello! Your order is out for delivery 🚚',
          }, 'Only within 24 hours of the customer\'s last message (otherwise error window_closed: send a template). Up to 4096 characters; WhatsApp formatting such as *bold* works.'),
          jsonRequest('Send text with reply buttons', 'messages/text', {
            to: '{{to}}',
            text: 'Would you like a call back?',
            buttons: ['Yes', 'No'],
          }, 'Up to 3 buttons show as buttons (20 characters each); up to 10 show as a list (24 characters). Titles must not contain commas.'),
          jsonRequest('Send attachment (URL)', 'messages/media', {
            to: '{{to}}',
            url: 'https://example.com/brochure.pdf',
            caption: 'Our new brochure',
          }, 'Within the 24-hour window. Images (.jpg, .png, .webp), videos (.mp4, .3gp), documents (.pdf, .doc(x), .xls(x), .ppt(x), .txt, .csv), up to 16 MB. The URL must end in the file extension.'),
          formRequest('Send attachment (upload)', 'messages/media', [
            ['to', '{{to}}'],
            ['caption', 'Your invoice'],
            ['file', '', 'file', 'The attachment'],
          ], 'Same as Send attachment, uploading the file (multipart/form-data).'),
          {
            name: 'Message status',
            event: test(CHECK),
            request: {
              method: 'GET',
              header: [],
              url: url('messages/{{message_id}}'),
              description: 'status: processing, queued, sent, delivered, read, failed (see error), opted_out or cancelled. message_id is filled in by the last send request.',
            },
          },
        ],
      },
    ],
  };
}
