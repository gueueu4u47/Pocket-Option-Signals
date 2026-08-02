const fs = require("fs");
const path = require("path");

const FIXES = [
  ["��पर", "ऊपर"],
  ["In����cio", "Início"],
  ["ميغابا����ت", "ميغابايت"],
  ["Г��афик талдауы", "График талдауы"],
  ["शां���", "शांत"],
  ["э��ап", "этап"],
  ["запаса ��ода", "запаса хода"],
  ["Не�� данных", "Нет данных"],
  ["движение ��живёт", "движение оживёт"],
  ["3���15", "3–15"]
];

module.exports = (req, res) => {
  let html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  for (const [broken, fixed] of FIXES) html = html.split(broken).join(fixed);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  return res.status(200).send(html);
};