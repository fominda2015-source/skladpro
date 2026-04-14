import crypto from "node:crypto";
import fs from "node:fs";

export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const rs = fs.createReadStream(absPath);
    rs.on("error", reject);
    rs.on("data", (chunk) => {
      hash.update(chunk);
    });
    rs.on("end", () => resolve(hash.digest("hex")));
  });
}
