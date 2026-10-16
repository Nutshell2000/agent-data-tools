module.exports = {
  notation: '<main><h1 id="power">Limit 2<sup>31</sup></h1><p>Maximum 2<sup>31</sup>; water H<sub>2</sub>O; nested x<sup>a<sub>i</sub></sup>; cite<sup><a href="#power">1</a></sup>.</p><p>Inline <code>x<sup>2</sup> + y<sub>i</sub></code>.</p><pre><code>2<sup>31</sup>\nH<sub>2</sub>O</code></pre></main>',
  notationTable: '<main><h2 id="limit">Capacity 2<sup>31</sup></h2><table><caption>H<sub>2</sub>O</caption><tr><th>Term</th><th>Value</th></tr><tr><td>Power</td><td>2<sup>31</sup></td></tr><tr><td>Index</td><td>x<sub>i</sub></td></tr><tr><td>Code</td><td><code>x<sup>2</sup></code></td></tr></table></main>',
  notationLiteral: '<main><h1 id="plain">Literal</h1><pre>2<sup>31</sup>\nH<sub>2</sub>O</pre><p><code>x<sup>2</sup></code><span hidden>2<sup>99</sup></span>empty<sup></sup></p><h1 id="outside">Other 2<sup>8</sup></h1></main>',

  permalinks: '<main><h1 id="intro">Guide<a class="headerlink" href="#intro">¶</a></h1><p id="rule">Keep the actual rule.<a class="pilcrow" href="#rule">¶</a></p><p><a href="#rule">Read that rule</a></p><section id="plain"><h2 id="plain-title">No controls here</h2><p>Selected scope.</p></section></main>',
  permalinkReferences: '<main><h1 id="here">References</h1><p><a class="pilcrow" href="#elsewhere">¶</a> <a href="#here">#</a> <a class="pilcrow" href="https://other.example/page#here">¶</a> <a class="PILCROW" href="#here">¶</a> <a class="permalink" href="#here">Full reference</a> <a class="pilcrow" href="#bad%ZZ">¶</a></p><div id="elsewhere">Actual target.</div></main>',
  permalinkLiteral: '<main><pre id="literal"><code>first  \n<a class="pilcrow" href="#literal">¶</a>\n    last</code></pre><p>Literal prose ¶ and # remain.</p></main>',
  permalinkBase: '<html><head><base href="https://other.example/page"></head><body><main><p id="rule">A source link.<a class="pilcrow" href="#rule">¶</a></p></main></body></html>',
  permalinkTable: '<main><table><tr><th>Limit</th></tr><tr><td id="cell">42<a class="pilcrow" href="#cell">¶</a></td></tr></table></main>',
  permalinkBudget: '<main>'+Array.from({length:200},(_,i)=>'<p id="p'+i+'">Rule '+i+'.<a class="pilcrow" href="#p'+i+'">¶</a></p>').join('')+'<pre><code>'+'x'.repeat(12000)+'</code></pre></main>',

  tableBoundaries: '<main><table><caption>API<br>permissions</caption><tr><th>Operations</th><th>Notes</th></tr><tr><td>Read<br>Write</td><td><p>First rule</p><p>Second rule</p></td></tr><tr><td><ul><li>Open</li><li>Close</li></ul></td><td><code>read</code>Only <span hidden>SECRET</span><span>visible</span><img alt="state diagram"></td></tr></table></main>',
  manyTables: '<main>'+Array.from({length:21},(_,i)=>'<table><tr><td>table_'+i+'</td><td>value_'+i+'</td></tr></table>').join('')+'<table>'+Array.from({length:110},(_,i)=>'<tr><td>row_'+i+'</td><td>data_'+i+'</td></tr>').join('')+'</table></main>',
  codeWhitespace: '<main><pre><code class="language-text">first  \n\n\n\n    second\nlast  </code></pre></main>',
  tableAfterLinks: '<main>'+Array.from({length:200},(_,i)=>'<a href="https://public.example/'+i+'/'+ 'x'.repeat(120)+'">Reference '+i+'</a> ').join('')+'<table><tr><th>Parameter</th><th>Value</th></tr><tr><td>critical_limit</td><td>314159</td></tr></table></main>',
  nestedLists: '<main><ol start="3"><li>Outer step<ul><li>Nested detail<ol start="8"><li>Deeper</li></ol></li></ul></li><li value="7">Next step</li></ol></main>',
  ordered: '<main><ol start="3"><li>Third step</li><li>Fourth step</li></ol><div class="highlight-python3"><pre>def f():\n    return 1</pre></div></main>',

  deep: '<div>'.repeat(140)+'text'+'</div>'.repeat(140),
  many: '<main>'+ '<span>x</span>'.repeat(20001)+'</main>',
  bigcode: '<main><pre><code class="language-text">'+ '`'.repeat(200000)+'</code></pre></main>',

  short: '<html><head><title>Short note</title></head><body><header>Unrelated site header</header><main><h1>Release note</h1><p>Version 2 fixes parsing.</p></main><div>Unrelated site links</div></body></html>',
  hidden: '<html><body><main><h1>Visible note</h1><p>Keep this information.</p><span hidden>HIDDEN_ONE</span><div aria-hidden="true">HIDDEN_TWO</div><span style="display:none">HIDDEN_THREE</span><div class="cookie-banner">COOKIE_NOTICE</div></main></body></html>',
  code: '<html><body><main><h1>Example</h1><pre><code class="language-python">def greet(name):\n    return f"Hello {name}"\n\nprint(greet("Ada"))</code></pre><p>Inline <code>x &lt; 2</code> remains readable.</p></main></body></html>',
  table: '<html><body><article><h1>Limits</h1><table><caption>Plan limits</caption><thead><tr><th>Plan</th><th>Requests</th></tr></thead><tbody><tr><td>Starter</td><td>100</td></tr><tr><td>Pro</td><td>2,000</td></tr></tbody></table></article></body></html>',
  entities: '<html><head><title>Prices &amp; terms</title><link rel="canonical" href="/docs/prices"></head><body><main><p>&copy; 2026 &mdash; &euro;5 &amp; &amp;lt;tag&amp;gt;</p><a href="/next?a=1&amp;b=2">Next &amp; more</a><a href="javascript:alert(1)">No executable link</a></main><a href="/outside">Outside article</a></body></html>',
  malformed: '<main><h1>Notes</h1><p>First paragraph<p>Second paragraph<ul><li>First item<li>Second item</ul><p>Last paragraph</main>',
  shell: '<html><head><title>Application</title></head><body><div id="app"></div><script>document.write("Generated content")</script></body></html>',
  challenge: '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Checking your browser before continuing</div><script src="/cdn-cgi/challenge-platform/a.js"></script></body></html>',
  spans: '<article><h1>Matrix</h1><table><tr><th>Team</th><th>Day</th></tr><tr><td rowspan="2">A</td><td>Monday</td></tr><tr><td>Tuesday</td></tr></table></article>',
};
