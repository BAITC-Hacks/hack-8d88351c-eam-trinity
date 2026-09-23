import { evaluateScenario } from "@/lib/model/engine";
export async function POST(request: Request) {
  try {
    const result = evaluateScenario(await request.json());
    return Response.json(result, { status: result.valid ? 200 : 422 });
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
}
