// Queue lanes: one entry per PHP cron script that sent queued messages.
// Each lane runs independently in the worker, like the separate crons did.

export type Lane =
  | {
      /** wa_cron.php / wa_novelty.php / wa_clients.php style: fixed batch per user. */
      kind: "users";
      name: string;
      users: { parentIn?: number[]; parentNotIn?: number[]; idIn?: number[]; idNotIn?: number[] };
      perUserLimit: number;
      queueWindowSeconds: number;
      variant: "meta" | "template";
    }
  | {
      /** send_whatsapp.php <mv_id>: parent ids come from js_master_value.mv_desc,
       *  a total budget is shared between users, and status is written back to that row. */
      kind: "group";
      name: string;
      masterValueId: number;
      totalLimit: number;
      queueWindowSeconds: number;
      variant: "meta" | "template";
    };

const DAYS = 86_400;

export const LANES: Lane[] = [
  {
    kind: "users",
    name: "general", // cron/wa_cron.php
    users: { parentNotIn: [21, 55], idNotIn: [11, 49, 52, 46, 58, 59, 56, 57] },
    perUserLimit: 100,
    queueWindowSeconds: 3 * DAYS,
    variant: "meta",
  },
  {
    kind: "users",
    name: "novelty", // cron/wa_novelty.php
    users: { parentIn: [21] },
    perUserLimit: 25,
    queueWindowSeconds: 3 * DAYS,
    variant: "meta",
  },
  {
    kind: "users",
    name: "clients", // cron/send_wa.sh -> wa_clients.php <id>
    users: { idIn: [7, 9, 46, 57, 65] },
    perUserLimit: 10,
    queueWindowSeconds: 3 * DAYS,
    variant: "meta",
  },
  // cron/*.sh -> send_whatsapp.php <mv_id>
  ...[
    { id: 56191, name: "clients-56191" },
    { id: 56200, name: "clients-56200" },
    { id: 56193, name: "tpem" },
    { id: 56194, name: "autodealer" },
    { id: 56196, name: "jscoretech-56196" },
    { id: 56197, name: "jscoretech-56197" },
    { id: 56199, name: "malucars" },
  ].map(
    (g): Lane => ({
      kind: "group",
      name: g.name,
      masterValueId: g.id,
      totalLimit: 75,
      queueWindowSeconds: 7 * DAYS,
      variant: "template",
    }),
  ),
];

/** Messages are only sent between these hours, India time (PHP: 7 <= H < 23). */
export const SEND_HOURS = { from: 7, to: 23 };
