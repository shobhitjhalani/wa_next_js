import { NextResponse } from "next/server";
import { logoutAdmin } from "@/lib/auth";

export async function GET(req: Request) {
  await logoutAdmin();
  return NextResponse.redirect(new URL("/wamaster", req.url));
}
