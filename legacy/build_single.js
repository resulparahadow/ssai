// build_single.js — inline all local css/js into one self-contained file.
// Usage: node build_single.js   →   writes SSAI_single.html
// Inlines <link href="css/*.css"> into <style> and <script src="js/*.js"> into
// <script>, preserving order. Leaves remote (http) scripts (e.g. the Supabase
// CDN) as external references. Re-run after editing any css/js.
const fs = require('fs');

let html = fs.readFileSync('SSAI.html', 'utf8');

// Guard: a literal </script> (or </style>) inside inlined code would close the
// tag early. Escaping the slash is harmless in JS strings/templates and CSS.
const guardJs  = s => s.replace(/<\/(script)/gi, '<\\/$1');
const guardCss = s => s.replace(/<\/(style)/gi, '<\\/$1');

// Inline local stylesheets.
html = html.replace(/<link\b[^>]*href="(css\/[^"]+)"[^>]*>/g, (m, p) => {
  const css = fs.readFileSync(p, 'utf8');
  return `<style>\n${guardCss(css)}\n</style>`;
});

// Inline local scripts only (src="js/..."); remote http(s) scripts untouched.
html = html.replace(/<script\s+src="(js\/[^"]+)"><\/script>/g, (m, p) => {
  const js = fs.readFileSync(p, 'utf8');
  return `<script>\n${guardJs(js)}\n</script>`;
});

fs.writeFileSync('SSAI_single.html', html);
console.log('wrote SSAI_single.html (' + fs.statSync('SSAI_single.html').size + ' bytes)');
