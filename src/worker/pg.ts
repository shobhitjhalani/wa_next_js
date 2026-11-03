// node-postgres connection settings from the Prisma DATABASE_URL.
import type { ClientConfig } from "pg";

// Query params that only Prisma understands; node-postgres would choke on or ignore them.
const PRISMA_ONLY = ["schema", "connection_limit", "pool_timeout", "pgbouncer", "connect_timeout", "socket_timeout", "statement_cache_size"];

/**
 * Keeps SSL working for DigitalOcean Managed Postgres (sslmode=require): the SSL params are
 * turned into an explicit `ssl` option, with the CA from PG_CA_CERT when it is set.
 */
export function pgConfigFromUrl(databaseUrl = process.env.DATABASE_URL ?? ""): ClientConfig {
  const url = new URL(databaseUrl);
  for (const p of PRISMA_ONLY) url.searchParams.delete(p);
  const sslmode = url.searchParams.get("sslmode");
  // pg parses sslmode itself (and treats require as verify-full); handle it explicitly instead.
  for (const p of ["sslmode", "sslcert", "sslkey", "sslrootcert", "sslaccept"]) url.searchParams.delete(p);

  const cfg: ClientConfig = { connectionString: url.toString() };
  if (sslmode && sslmode !== "disable") {
    const ca = process.env.PG_CA_CERT;
    // DO's CA is not in the system store, so verification needs PG_CA_CERT.
    cfg.ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  return cfg;
}
