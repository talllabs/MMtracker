import { requireLogin, loadData, saveData, readJson, sendError } from "./_lib.js";
import { cleanPrograms } from "./_programs.js";

// GET /api/data → everything (programs + recent activity)
// PUT /api/data { programs, activityNote? } → replaces the program list
export default async function handler(req, res) {
  if (!requireLogin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      return res.status(200).json(await loadData());
    }
    if (req.method === "PUT") {
      const body = readJson(req);
      const data = await loadData();
      data.programs = cleanPrograms(body.programs);
      data.updatedAt = new Date().toISOString();
      if (body.activityNote) {
        data.activity = [
          { at: data.updatedAt, note: String(body.activityNote).slice(0, 300) },
          ...(data.activity || []),
        ].slice(0, 50);
      }
      await saveData(data);
      return res.status(200).json(data);
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    sendError(res, err);
  }
}
