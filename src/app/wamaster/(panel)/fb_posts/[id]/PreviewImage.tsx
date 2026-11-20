'use client';

import { useState } from 'react';

/** The post image as Facebook will fetch it; a link that can't be loaded is flagged before anything is queued. */
export function PreviewImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="bg-danger-subtle text-danger small p-3 text-center">
        <i className="ri-image-off-line fs-3 d-block" />
        This image could not be loaded, so Facebook will refuse the post.<div className="text-break mt-1">{src}</div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className="w-100 d-block bg-light" style={{ maxHeight: 420, objectFit: 'contain' }} onError={() => setBroken(true)} />
  );
}
