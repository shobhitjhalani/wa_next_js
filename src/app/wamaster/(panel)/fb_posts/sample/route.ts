import { getAccess } from '@/lib/admin-access';
import { csvFromRows } from '@/lib/http';

/** GET /wamaster/fb_posts/sample — example CSV for bulk Facebook posts. */
export async function GET() {
  if (!(await getAccess()).can('fb_posts')) return new Response('Forbidden', { status: 403 });
  return csvFromRows('facebook-posts-sample.csv', ['message', 'image_url', 'link', 'schedule'], [
    ['New Tata Nexon EV is here! Book your test drive today.', 'https://wa.jscoretech.com/media/library/tata/nexon-ev.jpg', 'https://example.com/nexon-ev', '25-11-2026 10:30'],
    ['Diwali offers: up to ₹50,000 off on select models.\nVisit our showroom this weekend.', '', 'https://example.com/offers', '26-11-2026 18:00'],
    ['Thank you to all our customers for 10,000 deliveries!', 'https://wa.jscoretech.com/media/library/tata/10k.png', '', ''],
  ]);
}
