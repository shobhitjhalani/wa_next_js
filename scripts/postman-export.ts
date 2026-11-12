/** Write docs/WA-API-v2.postman_collection.json (placeholders for base URL and key). npm run -s postman:export */
import { mkdir, writeFile } from 'node:fs/promises';
import { postmanCollection } from '../src/lib/api/postman';

async function main() {
  await mkdir('docs', { recursive: true });
  const file = 'docs/WA-API-v2.postman_collection.json';
  await writeFile(file, JSON.stringify(postmanCollection('https://app.digitomation.com/api/v2', 'YOUR_API_KEY'), null, 2) + '\n');
  console.log('Wrote', file);
}
main();
