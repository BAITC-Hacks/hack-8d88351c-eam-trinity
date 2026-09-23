import { runStress, scenarioSchema } from "@/lib/model/engine";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const parsed = scenarioSchema
      .extend({ event_id: z.enum(["none", "winter_demo"]) })
      .strict()
      .safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "Некорректный запрос события" },
        { status: 400 },
      );
    const result = runStress(
      { decisions: parsed.data.decisions },
      parsed.data.event_id,
    );
    return Response.json(result, { status: result.valid ? 200 : 422 });
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
}
