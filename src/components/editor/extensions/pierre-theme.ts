import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Pierre Dark theme for CodeMirror
 * Colors extracted from @pierre/theme pierre-dark.json
 */
const pierreDarkColors = {
  bg: '#070707',
  fg: '#fbfbfb',
  cursor: '#009fff',
  selection: '#009fff4d',
  lineHighlight: '#19283c8c',
  lineNumber: '#84848A',
  lineNumberActive: '#adadb1',
  indentGuide: '#1F1F21',
  comment: '#84848A',
  string: '#5ecc71',
  number: '#68cdf2',
  constant: '#ffd452',
  keyword: '#ff678d',
  variable: '#ffa359',
  parameter: '#adadb1',
  function: '#9d6afb',
  type: '#d568ea',
  operator: '#79797F',
  operatorLogic: '#08c0ef',
  punctuation: '#79797F',
  namespace: '#ffca00',
  tag: '#ff678d',
  attribute: '#ffa359',
};

const pierreDarkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: pierreDarkColors.bg,
      color: pierreDarkColors.fg,
    },
    '.cm-content': {
      caretColor: pierreDarkColors.cursor,
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: pierreDarkColors.cursor,
      borderLeftWidth: '2px',
    },
    '& .cm-cursorLayer': {
      animation: 'none !important',
    },
    '.cm-activeLine': {
      backgroundColor: pierreDarkColors.lineHighlight,
    },
    '.cm-activeLineGutter': {
      backgroundColor: pierreDarkColors.lineHighlight,
    },
    '.cm-gutters': {
      backgroundColor: pierreDarkColors.bg,
      color: pierreDarkColors.lineNumber,
      borderRight: 'none',
    },
    '.cm-gutterElement': {
      color: pierreDarkColors.lineNumber,
    },
    '.cm-activeLineGutter .cm-gutterElement': {
      color: pierreDarkColors.lineNumberActive,
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: pierreDarkColors.selection,
    },
    '.cm-selectionBackground': {
      backgroundColor: '#009fff33',
    },
    '.cm-content ::selection': {
      backgroundColor: pierreDarkColors.selection,
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(245, 158, 11, 0.22)',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#009fff33',
      outline: '1px solid #009fff66',
    },
    '.cm-searchMatch': {
      backgroundColor: '#ffd45244',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#ffd45288',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#1F1F21',
      color: pierreDarkColors.lineNumber,
      border: 'none',
    },
  },
  { dark: true }
);

const pierreDarkHighlight = HighlightStyle.define([
  { tag: t.comment, color: pierreDarkColors.comment },
  { tag: t.lineComment, color: pierreDarkColors.comment },
  { tag: t.blockComment, color: pierreDarkColors.comment },
  { tag: t.docComment, color: pierreDarkColors.comment },

  { tag: t.string, color: pierreDarkColors.string },
  { tag: t.special(t.string), color: pierreDarkColors.string },
  { tag: t.regexp, color: pierreDarkColors.string },

  { tag: t.number, color: pierreDarkColors.number },
  { tag: t.integer, color: pierreDarkColors.number },
  { tag: t.float, color: pierreDarkColors.number },
  { tag: t.bool, color: pierreDarkColors.number },

  { tag: t.keyword, color: pierreDarkColors.keyword },
  { tag: t.controlKeyword, color: pierreDarkColors.keyword },
  { tag: t.operatorKeyword, color: pierreDarkColors.keyword },
  { tag: t.moduleKeyword, color: pierreDarkColors.keyword },
  { tag: t.definitionKeyword, color: pierreDarkColors.keyword },

  { tag: t.variableName, color: pierreDarkColors.variable },
  { tag: t.definition(t.variableName), color: pierreDarkColors.variable },
  { tag: t.special(t.variableName), color: pierreDarkColors.namespace },

  { tag: t.function(t.variableName), color: pierreDarkColors.function },
  { tag: t.definition(t.function(t.variableName)), color: pierreDarkColors.function },
  { tag: t.function(t.propertyName), color: pierreDarkColors.function },

  { tag: t.typeName, color: pierreDarkColors.type },
  { tag: t.className, color: pierreDarkColors.type },
  { tag: t.namespace, color: pierreDarkColors.namespace },

  { tag: t.propertyName, color: pierreDarkColors.variable },
  { tag: t.definition(t.propertyName), color: pierreDarkColors.variable },

  { tag: t.operator, color: pierreDarkColors.operatorLogic },
  { tag: t.compareOperator, color: pierreDarkColors.operatorLogic },
  { tag: t.logicOperator, color: pierreDarkColors.operatorLogic },
  { tag: t.bitwiseOperator, color: pierreDarkColors.operatorLogic },
  { tag: t.arithmeticOperator, color: pierreDarkColors.operatorLogic },
  { tag: t.updateOperator, color: pierreDarkColors.operatorLogic },
  { tag: t.definitionOperator, color: pierreDarkColors.operatorLogic },

  { tag: t.punctuation, color: pierreDarkColors.punctuation },
  { tag: t.separator, color: pierreDarkColors.punctuation },
  { tag: t.bracket, color: pierreDarkColors.punctuation },
  { tag: t.angleBracket, color: pierreDarkColors.punctuation },
  { tag: t.squareBracket, color: pierreDarkColors.punctuation },
  { tag: t.paren, color: pierreDarkColors.punctuation },
  { tag: t.brace, color: pierreDarkColors.punctuation },

  { tag: t.tagName, color: pierreDarkColors.tag },
  { tag: t.attributeName, color: pierreDarkColors.attribute },
  { tag: t.attributeValue, color: pierreDarkColors.string },

  { tag: t.constant(t.variableName), color: pierreDarkColors.constant },
  { tag: t.atom, color: pierreDarkColors.number },
  { tag: t.null, color: pierreDarkColors.number },

  { tag: t.self, color: pierreDarkColors.namespace },
  { tag: t.labelName, color: pierreDarkColors.variable },
  { tag: t.inserted, color: pierreDarkColors.string },
  { tag: t.deleted, color: pierreDarkColors.keyword },
  { tag: t.changed, color: pierreDarkColors.number },

  { tag: t.meta, color: pierreDarkColors.lineNumber },
  { tag: t.documentMeta, color: pierreDarkColors.lineNumber },
  { tag: t.annotation, color: pierreDarkColors.lineNumber },
  { tag: t.processingInstruction, color: pierreDarkColors.lineNumber },

  { tag: t.heading, color: pierreDarkColors.fg, fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: pierreDarkColors.cursor, textDecoration: 'underline' },
  { tag: t.url, color: pierreDarkColors.cursor, textDecoration: 'underline' },
  { tag: t.escape, color: pierreDarkColors.number },
  { tag: t.invalid, color: '#ff2e3f' },
]);

/**
 * Pierre Light theme for CodeMirror
 * Colors extracted from @pierre/theme pierre-light.json
 */
const pierreLightColors = {
  bg: '#ffffff',
  fg: '#070707',
  cursor: '#009fff',
  selection: '#009fff2e',
  lineHighlight: '#dfebff8c',
  lineNumber: '#84848A',
  lineNumberActive: '#6C6C71',
  indentGuide: '#eeeeef',
  comment: '#84848A',
  string: '#199f43',
  number: '#1ca1c7',
  constant: '#d5a910',
  keyword: '#fc2b73',
  variable: '#d47628',
  parameter: '#79797F',
  function: '#7b43f8',
  type: '#b839d0',
  operator: '#6C6C71',
  operatorLogic: '#1ca1c7',
  punctuation: '#79797F',
  namespace: '#d5a910',
  tag: '#fc2b73',
  attribute: '#d47628',
};

const pierreLightTheme = EditorView.theme({
  '&': {
    backgroundColor: pierreLightColors.bg,
    color: pierreLightColors.fg,
  },
  '.cm-content': {
    caretColor: pierreLightColors.cursor,
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: pierreLightColors.cursor,
    borderLeftWidth: '2px',
  },
  '& .cm-cursorLayer': {
    animation: 'none !important',
  },
  '.cm-activeLine': {
    backgroundColor: pierreLightColors.lineHighlight,
  },
  '.cm-activeLineGutter': {
    backgroundColor: pierreLightColors.lineHighlight,
  },
  '.cm-gutters': {
    backgroundColor: pierreLightColors.bg,
    color: pierreLightColors.lineNumber,
    borderRight: 'none',
  },
  '.cm-gutterElement': {
    color: pierreLightColors.lineNumber,
  },
  '.cm-activeLineGutter .cm-gutterElement': {
    color: pierreLightColors.lineNumberActive,
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: pierreLightColors.selection,
  },
  '.cm-selectionBackground': {
    backgroundColor: '#009fff1a',
  },
  '.cm-content ::selection': {
    backgroundColor: pierreLightColors.selection,
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
  },
  '.cm-matchingBracket': {
    backgroundColor: '#009fff22',
    outline: '1px solid #009fff44',
  },
  '.cm-searchMatch': {
    backgroundColor: '#d5a91044',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#d5a91088',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#eeeeef',
    color: pierreLightColors.lineNumber,
    border: 'none',
  },
});

const pierreLightHighlight = HighlightStyle.define([
  { tag: t.comment, color: pierreLightColors.comment },
  { tag: t.lineComment, color: pierreLightColors.comment },
  { tag: t.blockComment, color: pierreLightColors.comment },
  { tag: t.docComment, color: pierreLightColors.comment },

  { tag: t.string, color: pierreLightColors.string },
  { tag: t.special(t.string), color: pierreLightColors.string },
  { tag: t.regexp, color: pierreLightColors.string },

  { tag: t.number, color: pierreLightColors.number },
  { tag: t.integer, color: pierreLightColors.number },
  { tag: t.float, color: pierreLightColors.number },
  { tag: t.bool, color: pierreLightColors.number },

  { tag: t.keyword, color: pierreLightColors.keyword },
  { tag: t.controlKeyword, color: pierreLightColors.keyword },
  { tag: t.operatorKeyword, color: pierreLightColors.keyword },
  { tag: t.moduleKeyword, color: pierreLightColors.keyword },
  { tag: t.definitionKeyword, color: pierreLightColors.keyword },

  { tag: t.variableName, color: pierreLightColors.variable },
  { tag: t.definition(t.variableName), color: pierreLightColors.variable },
  { tag: t.special(t.variableName), color: pierreLightColors.namespace },

  { tag: t.function(t.variableName), color: pierreLightColors.function },
  { tag: t.definition(t.function(t.variableName)), color: pierreLightColors.function },
  { tag: t.function(t.propertyName), color: pierreLightColors.function },

  { tag: t.typeName, color: pierreLightColors.type },
  { tag: t.className, color: pierreLightColors.type },
  { tag: t.namespace, color: pierreLightColors.namespace },

  { tag: t.propertyName, color: pierreLightColors.variable },
  { tag: t.definition(t.propertyName), color: pierreLightColors.variable },

  { tag: t.operator, color: pierreLightColors.operatorLogic },
  { tag: t.compareOperator, color: pierreLightColors.operatorLogic },
  { tag: t.logicOperator, color: pierreLightColors.operatorLogic },
  { tag: t.bitwiseOperator, color: pierreLightColors.operatorLogic },
  { tag: t.arithmeticOperator, color: pierreLightColors.operatorLogic },
  { tag: t.updateOperator, color: pierreLightColors.operatorLogic },
  { tag: t.definitionOperator, color: pierreLightColors.operatorLogic },

  { tag: t.punctuation, color: pierreLightColors.punctuation },
  { tag: t.separator, color: pierreLightColors.punctuation },
  { tag: t.bracket, color: pierreLightColors.punctuation },
  { tag: t.angleBracket, color: pierreLightColors.punctuation },
  { tag: t.squareBracket, color: pierreLightColors.punctuation },
  { tag: t.paren, color: pierreLightColors.punctuation },
  { tag: t.brace, color: pierreLightColors.punctuation },

  { tag: t.tagName, color: pierreLightColors.tag },
  { tag: t.attributeName, color: pierreLightColors.attribute },
  { tag: t.attributeValue, color: pierreLightColors.string },

  { tag: t.constant(t.variableName), color: pierreLightColors.constant },
  { tag: t.atom, color: pierreLightColors.number },
  { tag: t.null, color: pierreLightColors.number },

  { tag: t.self, color: pierreLightColors.namespace },
  { tag: t.labelName, color: pierreLightColors.variable },
  { tag: t.inserted, color: pierreLightColors.string },
  { tag: t.deleted, color: pierreLightColors.keyword },
  { tag: t.changed, color: pierreLightColors.number },

  { tag: t.meta, color: pierreLightColors.lineNumber },
  { tag: t.documentMeta, color: pierreLightColors.lineNumber },
  { tag: t.annotation, color: pierreLightColors.lineNumber },
  { tag: t.processingInstruction, color: pierreLightColors.lineNumber },

  { tag: t.heading, color: pierreLightColors.fg, fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: pierreLightColors.cursor, textDecoration: 'underline' },
  { tag: t.url, color: pierreLightColors.cursor, textDecoration: 'underline' },
  { tag: t.escape, color: pierreLightColors.number },
  { tag: t.invalid, color: '#ff2e3f' },
]);

/** Pierre Dark theme — drop-in replacement for oneDark */
export const pierreDark = [pierreDarkTheme, syntaxHighlighting(pierreDarkHighlight)];

/** Pierre Light theme */
export const pierreLight = [pierreLightTheme, syntaxHighlighting(pierreLightHighlight)];
