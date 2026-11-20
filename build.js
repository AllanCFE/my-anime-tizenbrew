var fs = require("fs");
var path = require("path");
var vm = require("vm");

var rootDir = __dirname;
var srcDir = path.join(rootDir, "src");
var distDir = path.join(rootDir, "dist");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

function stripStringsAndComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function verifyEs5Compatibility(filePath, code) {
  /* 1. Syntax check via Node vm.Script */
  new vm.Script(code, { filename: filePath });

  /* 2. Ensure no ES6+ tokens outside strings/comments */
  var stripped = stripStringsAndComments(code);
  var checks = [
    { name: "arrow function (=>)", regex: /=>/ },
    { name: "const declaration", regex: /\bconst\s+/ },
    { name: "let declaration", regex: /\blet\s+/ },
    { name: "template literal (`)", regex: /`/ },
    { name: "class declaration", regex: /\bclass\s+[A-Za-z_]/ },
    { name: "async/await", regex: /\b(async|await)\s+/ }
  ];

  for (var i = 0; i < checks.length; i++) {
    if (checks[i].regex.test(stripped)) {
      throw new Error("ES5 check failed in " + filePath + ": found " + checks[i].name);
    }
  }
}

var files = ["service.js", "index.js"];
for (var i = 0; i < files.length; i++) {
  var name = files[i];
  var srcPath = path.join(srcDir, name);
  var distPath = path.join(distDir, name);
  var code = fs.readFileSync(srcPath, "utf8");
  verifyEs5Compatibility(name, code);
  fs.writeFileSync(distPath, code, "utf8");
  console.log("[Build] Verified ES5 & wrote dist/" + name + " (" + Buffer.byteLength(code, "utf8") + " bytes)");
}
