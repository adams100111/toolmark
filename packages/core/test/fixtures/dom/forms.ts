/** HTML fixtures for the DOM form adapter / synthesis tests (browser mode). */

/** One form with every control the synthesis table covers. */
export const typesForm = `
<form id="types">
  <input name="title" type="text" minlength="2" maxlength="40" pattern="[A-Z].*" required value="Hello">
  <input name="q" type="search">
  <textarea name="notes" maxlength="500">Some notes</textarea>
  <input name="email" type="email">
  <input name="site" type="url">
  <input name="phone" type="tel">
  <input name="qty" type="number" min="1" max="10">
  <input name="price" type="number" step="0.01" min="0">
  <input name="ratio" type="range" step="any" min="0" max="1">
  <input name="odd" type="number" step="2" min="1">
  <input name="even" type="number" step="2" value="4">
  <input name="half" type="number" min="0.5">
  <input name="day" type="date" min="2026-01-01" max="2026-12-31">
  <input name="at" type="time" min="09:00">
  <input name="when" type="datetime-local">
  <input name="agree" type="checkbox" checked>
  <input name="optin" type="checkbox">
  <input name="tags" type="checkbox" value="a" checked>
  <input name="tags" type="checkbox" value="b">
  <label><input name="size" type="radio" value="s"> Small</label>
  <label><input name="size" type="radio" value="m" checked> Medium</label>
  <select name="color" required>
    <option value="">Pick one</option>
    <option value="r">Red</option>
    <option value="g">Green</option>
  </select>
  <select name="langs" multiple>
    <option value="en" selected>English</option>
    <option value="ar">Arabic</option>
  </select>
  <input name="doc" type="file" accept="application/pdf, image/*, .txt">
  <input name="photos" type="file" multiple>
  <fieldset name="address">
    <input name="city">
    <input name="zip" pattern="\\d{5}">
  </fieldset>
  <button type="submit" name="go">Go</button>
</form>`

/** Controls that must never reach schemas, values, `changes` or writes. */
export const excludedForm = `
<form id="excluded">
  <input type="hidden" name="_token" value="csrf-secret">
  <input type="password" name="password" value="hunter2">
  <input name="card" autocomplete="cc-number" value="4111">
  <input name="cvc" autocomplete="billing cc-csc" value="123">
  <input name="locked" disabled value="x">
  <fieldset disabled><input name="inside" value="y"></fieldset>
  <input name="skipme" data-tool-ignore value="z">
  <div data-tool-ignore><input name="deep" value="w"></div>
  <input name="visible" value="ok">
</form>`

/** Description precedence: attribute → form `data-tool-param-*` → label → `aria-description`. */
export const descriptionsForm = `
<form id="desc" data-tool-param-a="From form A" data-tool-param-b="From form B">
  <label for="a">Label A</label>
  <input id="a" name="a" toolparamdescription="From attribute A" aria-description="Aria A">
  <label for="b">Label B</label>
  <input id="b" name="b" aria-description="Aria B">
  <label>Label C <input name="c" aria-description="Aria C"></label>
  <input name="d" aria-description="Aria D">
  <input name="e">
</form>`

/** Dotted, bracketed and fieldset-prefixed names. */
export const pathsForm = `
<form id="paths">
  <input name="a.b" value="ab">
  <input name="c[d]" value="cd">
  <input name="e[0][f]" value="e0">
  <input name="e[1][f]" value="e1">
  <fieldset name="g"><input name="h[i]" value="ghi"></fieldset>
</form>`

/** `[]` names and repeated names. */
export const arraysForm = `
<form id="arrays">
  <input name="list[]" value="one">
  <input name="list[]" value="two">
  <input name="dup" value="x">
  <input name="dup" value="y">
  <select name="sel[]" multiple>
    <option value="p" selected>P</option>
    <option value="q">Q</option>
  </select>
  <input name="flags[]" type="checkbox" value="f1">
  <input name="flags[]" type="checkbox" value="f2" checked>
</form>`

/** Controls for native filling. */
export const fillForm = `
<form id="fill">
  <input name="title" value="">
  <textarea name="notes"></textarea>
  <input name="qty" type="number">
  <input name="agree" type="checkbox">
  <input name="tags" type="checkbox" value="a">
  <input name="tags" type="checkbox" value="b">
  <input name="size" type="radio" value="s">
  <input name="size" type="radio" value="m">
  <select name="color"><option value="">-</option><option value="r">Red</option><option value="g">Green</option></select>
  <select name="langs" multiple><option value="en">English</option><option value="ar">Arabic</option></select>
  <input name="doc" type="file">
  <input name="photos" type="file" multiple>
</form>`
