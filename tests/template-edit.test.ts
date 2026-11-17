import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const editTemplate = vi.fn();
const uploadSample = vi.fn();
vi.mock('@/lib/services/meta', () => ({
  createTemplate: vi.fn(), fetchTemplates: vi.fn(),
  editTemplate: (...a: unknown[]) => editTemplate(...a),
  uploadSample: (...a: unknown[]) => uploadSample(...a),
}));

const { editStandardTemplate, templateFormValues } = await import('@/lib/services/templates');

const META = {
  id: '123456', name: 'order_update', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/x.jpg'] } },
    { type: 'BODY', text: 'Hi {{1}}, order {{2}} is ready', example: { body_text: [['Ravi', 'A12']] } },
    { type: 'FOOTER', text: 'Thanks' },
    { type: 'BUTTONS', buttons: [
      { type: 'URL', text: 'Track', url: 'https://x.in/o/{{1}}', example: ['https://x.in/o/1'] },
      { type: 'FLOW', text: 'Feedback', flow_id: '987654321', navigate_screen: 'ONE' },
    ] },
  ],
};

describe('template edit', () => {
  beforeEach(() => { editTemplate.mockReset(); uploadSample.mockReset(); });

  it('reads WhatsApp components into form values', () => {
    const v = templateFormValues(META);
    expect(v).toMatchObject({
      name: 'order_update', language: 'en_US', category: 'UTILITY', header_type: 'IMAGE',
      header_media: 'https://scontent.whatsapp.net/x.jpg', body: 'Hi {{1}}, order {{2}} is ready',
      body_example: { 1: 'Ravi', 2: 'A12' }, footer: 'Thanks',
    });
    expect(v.buttons[0]).toMatchObject({ type: 'URL', url: 'https://x.in/o/{{1}}', example: 'https://x.in/o/1' });
    expect(v.buttons[1]).toMatchObject({ type: 'FLOW', flow_id: '987654321', navigate_screen: 'ONE' });
  });

  it('keeps the current media header when no new sample is uploaded', async () => {
    editTemplate.mockResolvedValue({ success: true });
    const r = await editStandardTemplate(META, {
      name: 'order_update', language: 'en_US', category: 'UTILITY', header_type: 'IMAGE',
      body: 'Hello {{1}}', body_example: { 1: 'Ravi' }, footer: 'Thanks',
      buttons: [{ type: 'QUICK_REPLY', text: 'OK' }],
    }, null);
    expect(r.ok).toBe(true);
    expect(uploadSample).not.toHaveBeenCalled();
    const [id, payload] = editTemplate.mock.calls[0];
    expect(id).toBe('123456');
    expect(payload).toEqual({ components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/x.jpg'] } },
      { type: 'BODY', text: 'Hello {{1}}', example: { body_text: [['Ravi']] } },
      { type: 'FOOTER', text: 'Thanks' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'OK' }] },
    ] });
  });

  it('uploads a sample when the header type changes and reports WhatsApp errors', async () => {
    uploadSample.mockResolvedValue('4::handle');
    editTemplate.mockResolvedValue({ error: { message: 'x', error_user_msg: 'Edit limit reached' } });
    const file = new File([new Uint8Array([1, 2])], 'a.mp4', { type: 'video/mp4' });
    const r = await editStandardTemplate(META, {
      name: 'order_update', language: 'en_US', category: 'UTILITY', header_type: 'VIDEO', body: 'Hi', body_example: {},
    }, file);
    expect(uploadSample).toHaveBeenCalledOnce();
    expect(editTemplate.mock.calls[0][1].components[0]).toEqual({ type: 'HEADER', format: 'VIDEO', example: { header_handle: ['4::handle'] } });
    expect(r).toEqual({ ok: false, message: 'Edit limit reached' });
  });
});
