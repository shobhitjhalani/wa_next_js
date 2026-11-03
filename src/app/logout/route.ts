import { NextResponse } from "next/server";
import { logoutUser } from "@/lib/auth";

export async function GET(req: Request) {
  await logoutUser();
  return NextResponse.redirect(new URL("/", req.url));
}
