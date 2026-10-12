import { readFile, writeFile, readdir } from "node:fs/promises";
const modules = await readdir("node_modules");
const packages = [];
for (const entry of modules) {
  if (entry.startsWith(".")) continue;
  if (entry.startsWith("@"))
    for (const name of await readdir(`node_modules/${entry}`))
      packages.push(`${entry}/${name}`);
  else packages.push(entry);
}
let result =
  "阿贝创作助手代码使用MIT许可。下列为锁定构建依赖的第三方许可；仅构建使用的工具不属于助手运行时依赖。\n\n";
for (const name of packages.sort()) {
  const dir = `node_modules/${name}`;
  let meta;
  try {
    meta = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
  } catch {
    continue;
  }
  const license = (await readdir(dir)).find((f) =>
    /^licen[sc]e(?:\.(?:md|txt))?$/i.test(f),
  );
  result += `\n===== ${name}@${meta.version} (${typeof meta.license === "string" ? meta.license : "see package"}) =====\n`;
  if (license) result += await readFile(`${dir}/${license}`, "utf8");
  else
    result += `Source: ${typeof meta.repository === "string" ? meta.repository : (meta.repository?.url ?? meta.homepage ?? name)}\n`;
}
await writeFile("THIRD-PARTY-NOTICES.txt", result);
