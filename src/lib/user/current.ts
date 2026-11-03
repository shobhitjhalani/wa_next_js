import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";

/** requireUser() once per request (layout + page + actions share it). */
export const currentUser = cache(requireUser);
