import { NextResponse } from "next/server";
import { loadBoard } from "@/lib/predictions/board";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      200,
      Math.max(1, Number(searchParams.get("limit") ?? 50) || 50),
    );
    const board = await loadBoard(limit);
    return NextResponse.json(board);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
