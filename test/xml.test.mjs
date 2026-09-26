import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, XmlError, childElements, descendants, attr, childText } from '../src/lib/xml.js';

test('parses elements, attributes, text, CDATA, comments, a declaration and a DOCTYPE', () => {
  const root = parseXml(`﻿<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE Project>
<!-- leading comment -->
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003" ToolsVersion='12.0'>
  <PropertyGroup Condition=" '$(Configuration)' == 'Debug' ">
    <Name>A &amp; B &lt;&#65;&#x42;&gt;</Name>
    <Raw><![CDATA[<not a tag>]]></Raw>
  </PropertyGroup>
  <ms:Item xmlns:ms="urn:x" Include="x"/>
</Project>`);
  assert.equal(root.name, 'Project');
  assert.equal(attr(root, 'toolsversion'), '12.0', 'attribute lookup is case-insensitive');
  const group = childElements(root, 'PropertyGroup')[0];
  assert.equal(attr(group, 'Condition'), " '$(Configuration)' == 'Debug' ");
  assert.equal(childText(group, 'Name'), 'A & B <AB>');
  assert.equal(childText(group, 'Raw'), '<not a tag>');
  assert.equal(descendants(root, 'item')[0].localName, 'Item', 'prefixed names match on their local name');
});

const malformed = [
  ['mismatched closing tag', '<a><b></a>', 'mismatched-tag', 1, 7],
  ['unclosed element', '<a>\n  <b>\n', 'unclosed-tag', 2, 3],
  ['two root elements', '<a></a><b/>', 'multiple-roots', 1, 8],
  ['text instead of XML', 'hello <a/>', 'text-outside-root', 1, 1],
  ['nothing but a declaration', '<?xml version="1.0"?>', 'no-root', 1, 1],
  ['unquoted attribute', '<a x=1/>', 'bad-attribute', 1, 6],
  ['undeclared entity', '<a>&nbsp;</a>', 'bad-entity', 1, 4],
  ['bare ampersand', '<a>AT&T</a>', 'bad-entity', 1, 6],
  ['unterminated comment', '<a><!-- x </a>', 'unterminated-comment', 1, 4],
  ['stray closing tag', '</a>', 'unexpected-close', 1, 1],
  ['truncated start tag', '<Project Sdk="x"', 'unexpected-eof', 1, 1],
  ['mismatch on a later line', '<a>\n  <b>\n</a>', 'mismatched-tag', 3, 1],
];

for (const [name, input, reason, line, column] of malformed) {
  test(`rejects malformed XML: ${name}`, () => {
    assert.throws(
      () => parseXml(input),
      (e) => e instanceof XmlError && e.reason === reason && e.line === line && e.column === column,
    );
  });
}

test('never expands declared entities (no XXE, no entity bombs)', () => {
  const doc = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd"><!ENTITY y "boom">]><a>&y;</a>';
  assert.throws(() => parseXml(doc), (e) => e instanceof XmlError && e.reason === 'bad-entity');
});
