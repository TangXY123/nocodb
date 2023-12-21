import jsep from 'jsep';

import { ColumnType } from './Api';
import UITypes from './UITypes';
import dayjs from 'dayjs';

// todo: move to date utils and export, remove duplicate from gui

export const dateFormats = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD MM YYYY',
  'MM DD YYYY',
  'YYYY MM DD',
];

function validateDateWithUnknownFormat(v: string) {
  for (const format of dateFormats) {
    if (dayjs(v, format, true).isValid() as any) {
      return true;
    }
    for (const timeFormat of ['HH:mm', 'HH:mm:ss', 'HH:mm:ss.SSS']) {
      if (dayjs(v, `${format} ${timeFormat}`, true).isValid() as any) {
        return true;
      }
    }
  }
  return false;
}

export const jsepCurlyHook = {
  name: 'curly',
  init(jsep) {
    jsep.hooks.add('gobble-token', function gobbleCurlyLiteral(env) {
      const OCURLY_CODE = 123; // {
      const CCURLY_CODE = 125; // }
      let start = -1;
      const { context } = env;
      if (
        !jsep.isIdentifierStart(context.code) &&
        context.code === OCURLY_CODE
      ) {
        if (start == -1) {
          start = context.index;
        }
        context.index += 1;
        context.gobbleExpressions(CCURLY_CODE);
        if (context.code === CCURLY_CODE) {
          context.index += 1;
          env.node = {
            type: jsep.IDENTIFIER,
            name: /{{(.*?)}}/.test(context.expr)
              ? // start would be the position of the first curly bracket
                // add 2 to point to the first character for expressions like {{col1}}
                context.expr.slice(start + 2, context.index - 1)
              : // start would be the position of the first curly bracket
                // add 1 to point to the first character for expressions like {col1}
                context.expr.slice(start + 1, context.index - 1),
          };
          return env.node;
        } else {
          context.throwError('Unclosed }');
        }
      }
    });
  },
} as jsep.IPlugin;

export async function substituteColumnAliasWithIdInFormula(
  formula,
  columns: ColumnType[]
) {
  const substituteId = async (pt: any) => {
    if (pt.type === 'CallExpression') {
      for (const arg of pt.arguments || []) {
        await substituteId(arg);
      }
    } else if (pt.type === 'Literal') {
      return;
    } else if (pt.type === 'Identifier') {
      const colNameOrId = pt.name;
      const column = columns.find(
        (c) =>
          c.id === colNameOrId ||
          c.column_name === colNameOrId ||
          c.title === colNameOrId
      );
      pt.name = '{' + column.id + '}';
    } else if (pt.type === 'BinaryExpression') {
      await substituteId(pt.left);
      await substituteId(pt.right);
    }
  };
  // register jsep curly hook
  jsep.plugins.register(jsepCurlyHook);
  const parsedFormula = jsep(formula);
  await substituteId(parsedFormula);
  return jsepTreeToFormula(parsedFormula);
}

export enum FormulaErrorType {
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  MIN_ARG = 'MIN_ARG',
  MAX_ARG = 'MAX_ARG',
  TYPE_MISMATCH = 'TYPE_MISMATCH',
  INVALID_ARG = 'INVALID_ARG',
  INVALID_ARG_TYPE = 'INVALID_ARG_TYPE',
  INVALID_ARG_VALUE = 'INVALID_ARG_VALUE',
  INVALID_ARG_COUNT = 'INVALID_ARG_COUNT',
  CIRCULAR_REFERENCE = 'CIRCULAR_REFERENCE',
  INVALID_FUNCTION_NAME = 'INVALID_FUNCTION_NAME',
}

export function substituteColumnIdWithAliasInFormula(
  formula,
  columns: ColumnType[],
  rawFormula?
) {
  const substituteId = (pt: any, ptRaw?: any) => {
    if (pt.type === 'CallExpression') {
      let i = 0;
      for (const arg of pt.arguments || []) {
        substituteId(arg, ptRaw?.arguments?.[i++]);
      }
    } else if (pt.type === 'Literal') {
      return;
    } else if (pt.type === 'Identifier') {
      const colNameOrId = pt?.name;
      const column = columns.find(
        (c) =>
          c.id === colNameOrId ||
          c.column_name === colNameOrId ||
          c.title === colNameOrId
      );
      pt.name = column?.title || ptRaw?.name || pt?.name;
    } else if (pt.type === 'BinaryExpression') {
      substituteId(pt.left, ptRaw?.left);
      substituteId(pt.right, ptRaw?.right);
    }
  };

  // register jsep curly hook
  jsep.plugins.register(jsepCurlyHook);
  const parsedFormula = jsep(formula);
  const parsedRawFormula = rawFormula && jsep(rawFormula);
  substituteId(parsedFormula, parsedRawFormula);
  return jsepTreeToFormula(parsedFormula);
}

// isCallExpId - is the identifier part of a call expression
// in case of call expression, we don't want to wrap the identifier in curly brackets
export function jsepTreeToFormula(node, isCallExpId = false) {
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return (
      '(' +
      jsepTreeToFormula(node.left) +
      ' ' +
      node.operator +
      ' ' +
      jsepTreeToFormula(node.right) +
      ')'
    );
  }

  if (node.type === 'UnaryExpression') {
    return node.operator + jsepTreeToFormula(node.argument);
  }

  if (node.type === 'MemberExpression') {
    return (
      jsepTreeToFormula(node.object) +
      '[' +
      jsepTreeToFormula(node.property) +
      ']'
    );
  }

  if (node.type === 'Identifier') {
    if (!isCallExpId) return '{' + node.name + '}';
    return node.name;
  }

  if (node.type === 'Literal') {
    if (typeof node.value === 'string') {
      return String.raw`"${escapeLiteral(node.value)}"`;
    }
    return '' + node.value;
  }

  if (node.type === 'CallExpression') {
    return (
      jsepTreeToFormula(node.callee, true) +
      '(' +
      node.arguments.map(jsepTreeToFormula).join(', ') +
      ')'
    );
  }

  if (node.type === 'ArrayExpression') {
    return '[' + node.elements.map(jsepTreeToFormula).join(', ') + ']';
  }

  if (node.type === 'Compound') {
    return node.body.map((e) => jsepTreeToFormula(e)).join(' ');
  }

  if (node.type === 'ConditionalExpression') {
    return (
      jsepTreeToFormula(node.test) +
      ' ? ' +
      jsepTreeToFormula(node.consequent) +
      ' : ' +
      jsepTreeToFormula(node.alternate)
    );
  }

  return '';
}

function escapeLiteral(v: string) {
  return (
    v
      // replace \ to \\
      .replace(/\\/g, `\\\\`)
      // replace " to \"
      .replace(/"/g, `\\"`)
      // replace ' to \'
      .replace(/'/g, `\\'`)
  );
}

export enum FormulaDataTypes {
  NUMERIC = 'numeric',
  STRING = 'string',
  DATE = 'date',
  LOGICAL = 'logical',
  COND_EXP = 'conditional_expression',
  NULL = 'null',
  BOOLEAN = 'boolean',
}

export enum JSEPNode {
  COMPOUND = 'Compound',
  IDENTIFIER = 'Identifier',
  MEMBER_EXP = 'MemberExpression',
  LITERAL = 'Literal',
  THIS_EXP = 'ThisExpression',
  CALL_EXP = 'CallExpression',
  UNARY_EXP = 'UnaryExpression',
  BINARY_EXP = 'BinaryExpression',
  ARRAY_EXP = 'ArrayExpression',
}

interface FormulaMeta {
  validation?: {
    args?: {
      min?: number;
      max?: number;
      rqd?: number;

      type?: FormulaDataTypes;
    };
    custom?: (args: FormulaDataTypes[], parseTree: any) => void;
  };
  description?: string;
  syntax?: string;
  examples?: string[];
  returnType?: ((args: any[]) => FormulaDataTypes) | FormulaDataTypes;
}

const formulas: Record<string, FormulaMeta> = {
  AVG: {
    validation: {
      args: {
        min: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Average of input parameters',
    syntax: 'AVG(value1, [value2, ...])',
    examples: [
      'AVG(10, 5) => 7.5',
      'AVG({column1}, {column2})',
      'AVG({column1}, {column2}, {column3})',
    ],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ADD: {
    validation: {
      args: {
        min: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Sum of input parameters',
    syntax: 'ADD(value1, [value2, ...])',
    examples: [
      'ADD(5, 5) => 10',
      'ADD({column1}, {column2})',
      'ADD({column1}, {column2}, {column3})',
    ],
    returnType: FormulaDataTypes.NUMERIC,
  },
  DATEADD: {
    validation: {
      args: {
        rqd: 3,
        type: FormulaDataTypes.DATE,
      },
      custom: (_argTypes: FormulaDataTypes[], parsedTree: any) => {
        if (parsedTree.arguments[0].type === JSEPNode.LITERAL) {
          if (!validateDateWithUnknownFormat(parsedTree.arguments[0].value)) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.firstParamDateAddHaveDate' },
              'First parameter of DATEADD should be a date'
            );
          }
        }

        if (parsedTree.arguments[1].type === JSEPNode.LITERAL) {
          if (typeof parsedTree.arguments[1].value !== 'number') {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.secondParamDateAddHaveNumber' },
              'Second parameter of DATEADD should be a number'
            );
          }
        }
        if (parsedTree.arguments[2].type === JSEPNode.LITERAL) {
          if (
            !['day', 'week', 'month', 'year'].includes(
              parsedTree.arguments[2].value
            )
          ) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.thirdParamDateAddHaveDate' },
              "Third parameter of DATEADD should be one of 'day', 'week', 'month', 'year'"
            );
          }
        }
      },
    },
    description: 'Adds a "count" units to Datetime.',
    syntax:
      'DATEADD(date | datetime, value, ["day" | "week" | "month" | "year"])',
    examples: [
      'DATEADD({column1}, 2, "day")',
      'DATEADD({column1}, -2, "day")',
      'DATEADD({column1}, 2, "week")',
      'DATEADD({column1}, -2, "week")',
      'DATEADD({column1}, 2, "month")',
      'DATEADD({column1}, -2, "month")',
      'DATEADD({column1}, 2, "year")',
      'DATEADD({column1}, -2, "year")',
    ],
    returnType: FormulaDataTypes.DATE,
  },
  DATETIME_DIFF: {
    validation: {
      args: {
        min: 2,
        max: 3,
        type: FormulaDataTypes.DATE,
      },
      custom: (_argTypes: FormulaDataTypes[], parsedTree: any) => {
        if (parsedTree.arguments[0].type === JSEPNode.LITERAL) {
          if (!validateDateWithUnknownFormat(parsedTree.arguments[0].value)) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.firstParamDateDiffHaveDate' },
              'First parameter of DATETIME_DIFF should be a date'
            );
          }
        }

        if (parsedTree.arguments[1].type === JSEPNode.LITERAL) {
          if (!validateDateWithUnknownFormat(parsedTree.arguments[1].value)) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.secondParamDateDiffHaveDate' },
              'Second parameter of DATETIME_DIFF should be a date'
            );
          }
        }
        if (parsedTree.arguments[2].type === JSEPNode.LITERAL) {
          if (
            ![
              'milliseconds',
              'ms',
              'seconds',
              's',
              'minutes',
              'm',
              'hours',
              'h',
              'days',
              'd',
              'weeks',
              'w',
              'months',
              'M',
              'quarters',
              'Q',
              'years',
              'y',
            ].includes(parsedTree.arguments[0].value)
          ) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.thirdParamDateDiffHaveDate' },
              "Third parameter of DATETIME_DIFF should be one of 'milliseconds', 'ms', 'seconds', 's', 'minutes', 'm', 'hours', 'h', 'days', 'd', 'weeks', 'w', 'months', 'M', 'quarters', 'Q', 'years', 'y'"
            );
          }
        }
      },
    },
    description:
      'Calculate the difference of two given date / datetime in specified units.',
    syntax:
      'DATETIME_DIFF(date | datetime, date | datetime, ["milliseconds" | "ms" | "seconds" | "s" | "minutes" | "m" | "hours" | "h" | "days" | "d" | "weeks" | "w" | "months" | "M" | "quarters" | "Q" | "years" | "y"])',
    examples: [
      'DATEDIFF({column1}, {column2})',
      'DATEDIFF({column1}, {column2}, "seconds")',
      'DATEDIFF({column1}, {column2}, "s")',
      'DATEDIFF({column1}, {column2}, "years")',
      'DATEDIFF({column1}, {column2}, "y")',
      'DATEDIFF({column1}, {column2}, "minutes")',
      'DATEDIFF({column1}, {column2}, "m")',
      'DATEDIFF({column1}, {column2}, "days")',
      'DATEDIFF({column1}, {column2}, "d")',
    ],
    returnType: FormulaDataTypes.NUMERIC,
  },
  AND: {
    validation: {
      args: {
        min: 1,
      },
    },
    description: 'TRUE if all expr evaluate to TRUE',
    syntax: 'AND(expr1, [expr2, ...])',
    examples: ['AND(5 > 2, 5 < 10) => 1', 'AND({column1} > 2, {column2} < 10)'],
    returnType: FormulaDataTypes.COND_EXP,
  },
  OR: {
    validation: {
      args: {
        min: 1,
      },
    },
    description: 'TRUE if at least one expr evaluates to TRUE',
    syntax: 'OR(expr1, [expr2, ...])',
    examples: ['OR(5 > 2, 5 < 10) => 1', 'OR({column1} > 2, {column2} < 10)'],
    returnType: FormulaDataTypes.COND_EXP,
  },
  CONCAT: {
    validation: {
      args: {
        min: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Concatenated string of input parameters',
    syntax: 'CONCAT(str1, [str2, ...])',
    examples: [
      'CONCAT("AA", "BB", "CC") => "AABBCC"',
      'CONCAT({column1}, {column2}, {column3})',
    ],
    returnType: FormulaDataTypes.STRING,
  },
  TRIM: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Remove trailing and leading whitespaces from input parameter',
    syntax: 'TRIM(str)',
    examples: [
      'TRIM("         HELLO WORLD  ") => "HELLO WORLD"',
      'TRIM({column1})',
    ],
    returnType: FormulaDataTypes.STRING,
  },
  UPPER: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Upper case converted string of input parameter',
    syntax: 'UPPER(str)',
    examples: ['UPPER("nocodb") => "NOCODB"', 'UPPER({column1})'],
    returnType: FormulaDataTypes.STRING,
  },
  LOWER: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Lower case converted string of input parameter',
    syntax: 'LOWER(str)',
    examples: ['LOWER("NOCODB") => "nocodb"', 'LOWER({column1})'],
    returnType: FormulaDataTypes.STRING,
  },
  LEN: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Input parameter character length',
    syntax: 'LEN(value)',
    examples: ['LEN("NocoDB") => 6', 'LEN({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  MIN: {
    validation: {
      args: {
        min: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Minimum value amongst input parameters',
    syntax: 'MIN(value1, [value2, ...])',
    examples: ['MIN(1000, 2000) => 1000', 'MIN({column1}, {column2})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  MAX: {
    validation: {
      args: {
        min: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Maximum value amongst input parameters',
    syntax: 'MAX(value1, [value2, ...])',
    examples: ['MAX(1000, 2000) => 2000', 'MAX({column1}, {column2})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  CEILING: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Rounded next largest integer value of input parameter',
    syntax: 'CEILING(value)',
    examples: ['CEILING(1.01) => 2', 'CEILING({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  FLOOR: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Rounded largest integer less than or equal to input parameter',
    syntax: 'FLOOR(value)',
    examples: ['FLOOR(3.1415) => 3', 'FLOOR({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ROUND: {
    validation: {
      args: {
        min: 1,
        max: 2,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Rounded number to a specified number of decimal places or the nearest integer if not specified',
    syntax: 'ROUND(value, precision), ROUND(value)',
    examples: [
      'ROUND(3.1415) => 3',
      'ROUND(3.1415, 2) => 3.14',
      'ROUND({column1}, 3)',
    ],
    returnType: FormulaDataTypes.NUMERIC,
  },
  MOD: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Remainder after integer division of input parameters',
    syntax: 'MOD(value1, value2)',
    examples: ['MOD(1024, 1000) => 24', 'MOD({column}, 2)'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  REPEAT: {
    validation: {
      args: {
        rqd: 2,

        type: FormulaDataTypes.STRING,
      },
    },
    description:
      'Specified copies of the input parameter string concatenated together',
    syntax: 'REPEAT(str, count)',
    examples: ['REPEAT("A", 5) => "AAAAA"', 'REPEAT({column}, 5)'],
    returnType: FormulaDataTypes.STRING,
  },
  LOG: {
    validation: {
      args: {
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Logarithm of input parameter to the base (default = e) specified',
    syntax: 'LOG([base], value)',
    examples: ['LOG(2, 1024) => 10', 'LOG(2, {column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  EXP: {
    validation: {
      args: {
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Exponential value of input parameter (e ^ power)',
    syntax: 'EXP(power)',
    examples: ['EXP(1) => 2.718281828459045', 'EXP({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  POWER: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'base to the exponent power, as in base ^ exponent',
    syntax: 'POWER(base, exponent)',
    examples: ['POWER(2, 10) => 1024', 'POWER({column1}, 10)'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  SQRT: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Square root of the input parameter',
    syntax: 'SQRT(value)',
    examples: ['SQRT(100) => 10', 'SQRT({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ABS: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Absolute value of the input parameter',
    syntax: 'ABS(value)',
    examples: ['ABS({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  NOW: {
    validation: {
      args: {
        rqd: 0,
        type: FormulaDataTypes.DATE,
      },
    },
    description: 'Returns the current time and day',
    syntax: 'NOW()',
    examples: ['NOW() => 2022-05-19 17:20:43'],
    returnType: FormulaDataTypes.DATE,
  },
  REPLACE: {
    validation: {
      args: {
        rqd: 3,
        type: FormulaDataTypes.STRING,
      },
    },
    description:
      'String, after replacing all occurrences of srchStr with rplcStr',
    syntax: 'REPLACE(str, srchStr, rplcStr)',
    examples: [
      'REPLACE("AABBCC", "AA", "BB") => "BBBBCC"',
      'REPLACE({column1}, {column2}, {column3})',
    ],
    returnType: FormulaDataTypes.STRING,
  },
  SEARCH: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Index of srchStr specified if found, 0 otherwise',
    syntax: 'SEARCH(str, srchStr)',
    examples: [
      'SEARCH("HELLO WORLD", "WORLD") => 7',
      'SEARCH({column1}, "abc")',
    ],
    returnType: FormulaDataTypes.NUMERIC,
  },
  INT: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description: 'Integer value of input parameter',
    syntax: 'INT(value)',
    examples: ['INT(3.1415) => 3', 'INT({column1})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  RIGHT: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'n characters from the end of input parameter',
    syntax: 'RIGHT(str, n)',
    examples: ['RIGHT("HELLO WORLD", 5) => WORLD', 'RIGHT({column1}, 3)'],
    returnType: FormulaDataTypes.STRING,
  },
  LEFT: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'n characters from the beginning of input parameter',
    syntax: 'LEFT(str, n)',
    examples: ['LEFT({column1}, 2)', 'LEFT("ABCD", 2) => "AB"'],
    returnType: FormulaDataTypes.STRING,
  },
  SUBSTR: {
    validation: {
      args: {
        min: 2,
        max: 3,
        type: FormulaDataTypes.STRING,
      },
    },
    description:
      'Substring of length n of input string from the postition specified',
    syntax: '	SUBTR(str, position, [n])',
    examples: [
      'SUBSTR("HELLO WORLD", 7) => WORLD',
      'SUBSTR("HELLO WORLD", 7, 3) => WOR',
      'SUBSTR({column1}, 7, 5)',
    ],
    returnType: FormulaDataTypes.STRING,
  },
  MID: {
    validation: {
      args: {
        rqd: 3,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Alias for SUBSTR',
    syntax: 'MID(str, position, [count])',
    examples: ['MID("NocoDB", 3, 2) => "co"', 'MID({column1}, 3, 2)'],
    returnType: FormulaDataTypes.STRING,
  },
  IF: {
    validation: {
      args: {
        min: 2,
        max: 3,
      },
    },
    description: 'SuccessCase if expr evaluates to TRUE, elseCase otherwise',
    syntax: 'IF(expr, successCase, elseCase)',
    examples: [
      'IF(5 > 1, "YES", "NO") => "YES"',
      'IF({column} > 1, "YES", "NO")',
    ],
    returnType: (argTypes: FormulaDataTypes[]) => {
      // extract all return types except NULL, since null can be returned by any type
      const returnValueTypes = new Set(
        argTypes.slice(1).filter((type) => type !== FormulaDataTypes.NULL)
      );
      // if there are more than one return types or if there is a string return type
      // return type as string else return the type
      if (
        returnValueTypes.size > 1 ||
        returnValueTypes.has(FormulaDataTypes.STRING)
      ) {
        return FormulaDataTypes.STRING;
      } else if (returnValueTypes.has(FormulaDataTypes.NUMERIC)) {
        return FormulaDataTypes.NUMERIC;
      } else if (returnValueTypes.has(FormulaDataTypes.BOOLEAN)) {
        return FormulaDataTypes.BOOLEAN;
      } else if (returnValueTypes.has(FormulaDataTypes.DATE)) {
        return FormulaDataTypes.DATE;
      }

      // if none of the above conditions are met, return the first return argument type
      return argTypes[1];
    },
  },
  SWITCH: {
    validation: {
      args: {
        min: 3,
      },
      custom: (_argTypes: any[], _parseTree) => {
        // Todo: Add validation for switch
      },
    },
    description: 'Switch case value based on expr output',
    syntax: 'SWITCH(expr, [pattern, value, ..., default])',
    examples: [
      'SWITCH(1, 1, "One", 2, "Two", "N/A") => "One""',
      'SWITCH(2, 1, "One", 2, "Two", "N/A") => "Two"',
      'SWITCH(3, 1, "One", 2, "Two", "N/A") => "N/A"',
      'SWITCH({column1}, 1, "One", 2, "Two", "N/A")',
    ],
    returnType: (argTypes: FormulaDataTypes[]) => {
      // extract all return types except NULL, since null can be returned by any type
      const returnValueTypes = new Set(
        argTypes.slice(2).filter((_, i) => i % 2 === 0)
      );

      // if there are more than one return types or if there is a string return type
      // return type as string else return the type
      if (
        returnValueTypes.size > 1 ||
        returnValueTypes.has(FormulaDataTypes.STRING)
      ) {
        return FormulaDataTypes.STRING;
      } else if (returnValueTypes.has(FormulaDataTypes.NUMERIC)) {
        return FormulaDataTypes.NUMERIC;
      } else if (returnValueTypes.has(FormulaDataTypes.BOOLEAN)) {
        return FormulaDataTypes.BOOLEAN;
      } else if (returnValueTypes.has(FormulaDataTypes.DATE)) {
        return FormulaDataTypes.DATE;
      }

      // if none of the above conditions are met, return the first return argument type
      return argTypes[1];
    },
  },
  URL: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Convert to a hyperlink if it is a valid URL',
    syntax: 'URL(str)',
    examples: ['URL("https://github.com/nocodb/nocodb")', 'URL({column1})'],
    returnType: FormulaDataTypes.STRING,
  },
  WEEKDAY: {
    validation: {
      args: {
        min: 1,
        max: 2,
        type: FormulaDataTypes.NUMERIC,
      },
      custom(_argTypes: FormulaDataTypes[], parsedTree: any) {
        if (parsedTree.arguments[0].type === JSEPNode.LITERAL) {
          if (!validateDateWithUnknownFormat(parsedTree.arguments[0].value)) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.firstParamWeekDayHaveDate' },
              'First parameter of WEEKDAY should be a date'
            );
          }
        }

        if (parsedTree.arguments[1].type === JSEPNode.LITERAL) {
          const value = parsedTree.arguments[0].value;
          if (
            typeof value !== 'string' ||
            ![
              'sunday',
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
            ].includes(value.toLowerCase())
          ) {
            throw new FormulaError(
              FormulaErrorType.TYPE_MISMATCH,
              { key: 'msg.formula.secondParamWeekDayHaveDate' },
              'Second parameter of WEEKDAY should be day of week string'
            );
          }
        }
      },
    },
    description:
      'Returns the day of the week as an integer between 0 and 6 inclusive starting from Monday by default',
    syntax: 'WEEKDAY(date, [startDayOfWeek])',
    examples: ['WEEKDAY("2021-06-09")', 'WEEKDAY(NOW(), "sunday")'],
    returnType: FormulaDataTypes.NUMERIC,
  },

  TRUE: {
    validation: {
      args: {
        max: 0,
      },
    },
    description: 'Returns 1',
    syntax: 'TRUE()',
    examples: ['TRUE()'],
    returnType: FormulaDataTypes.NUMERIC,
  },

  FALSE: {
    validation: {
      args: {
        max: 0,
      },
    },
    description: 'Returns 0',
    syntax: 'FALSE()',
    examples: ['FALSE()'],
    returnType: FormulaDataTypes.NUMERIC,
  },

  REGEX_MATCH: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.STRING,
      },
    },
    description:
      'Returns 1 if the input text matches a regular expression or 0 if it does not.',
    syntax: 'REGEX_MATCH(string, regex)',
    examples: ['REGEX_MATCH({title}, "abc.*")'],
    returnType: FormulaDataTypes.NUMERIC,
  },

  REGEX_EXTRACT: {
    validation: {
      args: {
        rqd: 2,
        type: FormulaDataTypes.STRING,
      },
    },
    description: 'Returns the first match of a regular expression in a string.',
    syntax: 'REGEX_EXTRACT(string, regex)',
    examples: ['REGEX_EXTRACT({title}, "abc.*")'],
    returnType: FormulaDataTypes.STRING,
  },
  REGEX_REPLACE: {
    validation: {
      args: {
        rqd: 3,
        type: FormulaDataTypes.STRING,
      },
    },
    description:
      'Replaces all matches of a regular expression in a string with a replacement string',
    syntax: 'REGEX_MATCH(string, regex, replacement)',
    examples: ['REGEX_EXTRACT({title}, "abc.*", "abcd")'],
    returnType: FormulaDataTypes.STRING,
  },
  BLANK: {
    validation: {
      args: {
        rqd: 0,
      },
    },
    description: 'Returns a blank value(null)',
    syntax: 'BLANK()',
    examples: ['BLANK()'],
    returnType: FormulaDataTypes.NULL,
  },
  XOR: {
    validation: {
      args: {
        min: 1,
      },
      // todo: validation for boolean
    },
    description:
      'Returns true if an odd number of arguments are true, and false otherwise.',
    syntax: 'XOR(expression, [exp2, ...])',
    examples: ['XOR(TRUE(), FALSE(), TRUE())'],
    returnType: FormulaDataTypes.BOOLEAN,
  },
  EVEN: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Returns the nearest even integer that is greater than or equal to the specified value',
    syntax: 'EVEN(value)',
    examples: ['EVEN({column})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ODD: {
    validation: {
      args: {
        rqd: 1,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Returns the nearest odd integer that is greater than or equal to the specified value',
    syntax: 'ODD(value)',
    examples: ['ODD({column})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  RECORD_ID: {
    validation: {
      args: {
        rqd: 0,
      },
    },
    description: 'Returns the record id of the current record',
    syntax: 'RECORD_ID()',
    examples: ['RECORD_ID()'],

    // todo: resolve return type based on the args
    returnType: () => {
      return FormulaDataTypes.STRING;
    },
  },
  COUNTA: {
    validation: {
      args: {
        min: 1,
      },
    },
    description: 'Counts the number of non-empty arguments',
    syntax: 'COUNTA(value1, [value2, ...])',
    examples: ['COUNTA({field1}, {field2})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  COUNT: {
    validation: {
      args: {
        min: 1,
      },
    },
    description: 'Count the number of arguments that are numbers',
    syntax: 'COUNT(value1, [value2, ...])',
    examples: ['COUNT({field1}, {field2})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  COUNTALL: {
    validation: {
      args: {
        min: 1,
      },
    },
    description: 'Counts the number of arguments',
    syntax: 'COUNTALL(value1, [value2, ...])',
    examples: ['COUNTALL({field1}, {field2})'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ROUNDDOWN: {
    validation: {
      args: {
        min: 1,
        max: 2,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Round down the value after the decimal point to the number of decimal places given by "precision"(default is 0)',
    syntax: 'ROUNDDOWN(value, [precision])',
    examples: ['ROUNDDOWN({field1})', 'ROUNDDOWN({field1}, 2)'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  ROUNDUP: {
    validation: {
      args: {
        min: 1,
        max: 2,
        type: FormulaDataTypes.NUMERIC,
      },
    },
    description:
      'Round up the value after the decimal point to the number of decimal places given by "precision"(default is 0)',
    syntax: 'ROUNDUP(value, [precision])',
    examples: ['ROUNDUP({field1})', 'ROUNDUP({field1}, 2)'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  VALUE: {
    validation: {
      args: {
        rqd: 1,
      },
    },
    description:
      'Extract the numeric value from a string, if `%` or `-` is present, it will handle it accordingly and return the numeric value',
    syntax: 'VALUE(value)',
    examples: ['VALUE({field})', 'VALUE("abc10000%")', 'VALUE("$10000")'],
    returnType: FormulaDataTypes.NUMERIC,
  },
  // Disabling these functions for now; these act as alias for CreatedAt & UpdatedAt fields;
  // Issue: Error noticed if CreatedAt & UpdatedAt fields are removed from the table after creating these formulas
  //
  // CREATED_TIME: {
  //   validation: {
  //     args: {
  //       rqd: 0,
  //     },
  //   },
  //   description: 'Returns the created time of the current record if it exists',
  //   syntax: 'CREATED_TIME()',
  //   examples: ['CREATED_TIME()'],
  // },
  // LAST_MODIFIED_TIME: {
  //   validation: {
  //     args: {
  //       rqd: 0,
  //     },
  //   },
  //   description: 'Returns the last modified time of the current record if it exists',
  //   syntax: ' LAST_MODIFIED_TIME()',
  //   examples: [' LAST_MODIFIED_TIME()'],
  // },
};

export class FormulaError extends Error {
  public type: FormulaErrorType;
  public extra: Record<string, any>;

  constructor(
    type: FormulaErrorType,
    extra: {
      [key: string]: any;
    },
    message: string = 'Formula Error'
  ) {
    super(message);
    this.type = type;
    this.extra = extra;
  }
}

export function validateFormulaAndExtractTreeWithType(
  formula,
  columns: ColumnType[]
) {
  const colAliasToColMap = {};
  const colIdToColMap = {};

  for (const col of columns) {
    colAliasToColMap[col.title] = col;
    colIdToColMap[col.id] = col;
  }

  const validateAndExtract = (parsedTree: any) => {
    const res: {
      dataType?: FormulaDataTypes;
      errors?: Set<string>;
      [key: string]: any;
    } = { ...parsedTree };

    if (parsedTree.type === JSEPNode.CALL_EXP) {
      const calleeName = parsedTree.callee.name.toUpperCase();
      // validate function name
      if (!formulas[calleeName]) {
        throw new FormulaError(
          FormulaErrorType.INVALID_FUNCTION_NAME,
          {},
          'Function not available'
        );
      }

      // validate arguments
      const validation =
        formulas[calleeName] && formulas[calleeName].validation;
      if (validation && validation.args) {
        if (
          validation.args.rqd !== undefined &&
          validation.args.rqd !== parsedTree.arguments.length
        ) {
          throw new FormulaError(
            FormulaErrorType.INVALID_ARG,
            {
              key: 'msg.formula.requiredArgumentsFormula',
              requiredArguments: validation.args.rqd,
              calleeName,
            },
            'Required arguments missing'
          );
        } else if (
          validation.args.min !== undefined &&
          validation.args.min > parsedTree.arguments.length
        ) {
          throw new FormulaError(
            FormulaErrorType.MIN_ARG,
            {
              key: 'msg.formula.minRequiredArgumentsFormula',
              minRequiredArguments: validation.args.min,
              calleeName,
            },
            'Minimum arguments required'
          );
        } else if (
          validation.args.max !== undefined &&
          validation.args.max < parsedTree.arguments.length
        ) {
          throw new FormulaError(
            FormulaErrorType.INVALID_ARG,
            {
              key: 'msg.formula.maxRequiredArgumentsFormula',
              maxRequiredArguments: validation.args.max,
              calleeName,
            },
            'Maximum arguments missing'
          );
        }
      }
      // get args type and validate
      const validateResult = (res.arguments = parsedTree.arguments.map(
        (arg) => {
          return validateAndExtract(arg);
        }
      ));

      const argTypes = validateResult.map((v: any) => v.dataType);

      // if validation function is present, call it
      if (formulas[calleeName].validation?.custom) {
        formulas[calleeName].validation?.custom(argTypes, parsedTree);
      }
      // validate against expected arg types if present
      else if (formulas[calleeName].validation?.args?.type) {
        const expectedArgType = formulas[calleeName].validation.args.type;
        if (
          argTypes.some(
            (argType) =>
              argType !== expectedArgType && argType !== FormulaDataTypes.NULL
          )
        ) {
          let key = '';

          if (expectedArgType === FormulaDataTypes.NUMERIC) {
            key = 'msg.formula.numericTypeIsExpected';
          } else if (expectedArgType === FormulaDataTypes.STRING) {
            key = 'msg.formula.stringTypeIsExpected';
          } else if (expectedArgType === FormulaDataTypes.BOOLEAN) {
            key = 'msg.formula.booleanTypeIsExpected';
          } else if (expectedArgType === FormulaDataTypes.DATE) {
            key = 'msg.formula.dateTypeIsExpected';
          }

          throw new FormulaError(
            FormulaErrorType.INVALID_ARG,
            {
              key,
              calleeName,
            },
            'Invalid argument type'
          );
        }
      }

      if (typeof formulas[calleeName].returnType === 'function') {
        res.dataType = (formulas[calleeName].returnType as any)?.(
          argTypes
        ) as FormulaDataTypes;
      } else if (formulas[calleeName].returnType) {
        res.dataType = formulas[calleeName].returnType as FormulaDataTypes;
      }
    } else if (parsedTree.type === JSEPNode.IDENTIFIER) {
      const col = (colIdToColMap[parsedTree.name] ||
        colAliasToColMap[parsedTree.name]) as Record<string, any>;
      res.name = col.id;

      if (col?.uidt === UITypes.Formula) {
        // check for circular reference
        checkForCircularFormulaRef(col, parsedTree, columns);

        const formulaRes =
          col.colOptions?.parsed_tree ||
          validateFormulaAndExtractTreeWithType(
            // formula may include double curly brackets in previous version
            // convert to single curly bracket here for compatibility
            col.colOptions.formula.replaceAll('{{', '{').replaceAll('}}', '}'),
            columns
          );

        res.dataType = (formulaRes as any)?.dataType;
      } else {
        switch (col?.uidt) {
          // string
          case UITypes.SingleLineText:
          case UITypes.LongText:
          case UITypes.MultiSelect:
          case UITypes.SingleSelect:
          case UITypes.PhoneNumber:
          case UITypes.Email:
          case UITypes.URL:
            res.dataType = FormulaDataTypes.STRING;
            break;
          // numeric
          case UITypes.Year:
          case UITypes.Number:
          case UITypes.Decimal:
          case UITypes.Rating:
          case UITypes.Count:
          case UITypes.AutoNumber:
            res.dataType = FormulaDataTypes.NUMERIC;
            break;
          // date
          case UITypes.Date:
          case UITypes.DateTime:
          case UITypes.CreateTime:
          case UITypes.LastModifiedTime:
            res.dataType = FormulaDataTypes.DATE;
            break;
          // not supported
          case UITypes.ForeignKey:
          case UITypes.Attachment:
          case UITypes.ID:
          case UITypes.Time:
          case UITypes.Currency:
          case UITypes.Percent:
          case UITypes.Duration:
          case UITypes.Rollup:
          case UITypes.Lookup:
          case UITypes.Barcode:
          case UITypes.Button:
          case UITypes.Checkbox:
          case UITypes.Collaborator:
          case UITypes.QrCode:
          default:
            throw new FormulaError(FormulaErrorType.NOT_SUPPORTED, {});
        }
      }
    } else if (parsedTree.type === JSEPNode.LITERAL) {
      if (typeof parsedTree.value === 'number') {
        res.dataType = FormulaDataTypes.NUMERIC;
      } else if (typeof parsedTree.value === 'string') {
        res.dataType = FormulaDataTypes.STRING;
      } else if (typeof parsedTree.value === 'boolean') {
        res.dataType = FormulaDataTypes.BOOLEAN;
      } else {
        res.dataType = FormulaDataTypes.STRING;
      }
    } else if (
      parsedTree.type === JSEPNode.BINARY_EXP ||
      parsedTree.type === JSEPNode.UNARY_EXP
    ) {
      res.left = validateAndExtract(parsedTree.left);
      res.right = validateAndExtract(parsedTree.right);

      if (['==', '<', '>', '<=', '>=', '!='].includes(parsedTree.operator)) {
        res.dataType = FormulaDataTypes.COND_EXP;
      } else res.dataType = FormulaDataTypes.NUMERIC;
    }

    return res;
  };

  // register jsep curly hook
  jsep.plugins.register(jsepCurlyHook);
  const parsedFormula = jsep(formula);
  const result = validateAndExtract(parsedFormula);
  return result;
}

function checkForCircularFormulaRef(formulaCol, parsedTree, columns) {
  // check circular reference
  // e.g. formula1 -> formula2 -> formula1 should return circular reference error

  // get all formula columns excluding itself
  const formulaPaths = columns
    .filter((c) => c.id !== formulaCol?.id && c.uidt === UITypes.Formula)
    .reduce((res: Record<string, any>[], c: Record<string, any>) => {
      // in `formula`, get all the (unique) target neighbours
      // i.e. all column id (e.g. cxxxxxxxxxxxxxx) with formula type
      const neighbours = [
        ...new Set(
          (c.colOptions.formula.match(/c_?\w{14,15}/g) || []).filter(
            (colId: string) =>
              columns.filter(
                (col: ColumnType) =>
                  col.id === colId && col.uidt === UITypes.Formula
              ).length
          )
        ),
      ];
      if (neighbours.length > 0) {
        // e.g. formula column 1 -> [formula column 2, formula column3]
        res.push({ [c.id]: neighbours });
      }
      return res;
    }, []);

  // include target formula column (i.e. the one to be saved if applicable)
  const targetFormulaCol = columns.find(
    (c: ColumnType) => c.title === parsedTree.name && c.uidt === UITypes.Formula
  );

  if (targetFormulaCol && formulaCol?.id) {
    formulaPaths.push({
      [formulaCol?.id as string]: [targetFormulaCol.id],
    });
  }
  const vertices = formulaPaths.length;
  if (vertices > 0) {
    // perform kahn's algo for cycle detection
    const adj = new Map();
    const inDegrees = new Map();
    // init adjacency list & indegree

    for (const [_, v] of Object.entries(formulaPaths)) {
      const src = Object.keys(v)[0];
      const neighbours = v[src];
      inDegrees.set(src, inDegrees.get(src) || 0);
      for (const neighbour of neighbours) {
        adj.set(src, (adj.get(src) || new Set()).add(neighbour));
        inDegrees.set(neighbour, (inDegrees.get(neighbour) || 0) + 1);
      }
    }
    const queue: string[] = [];
    // put all vertices with in-degree = 0 (i.e. no incoming edges) to queue
    inDegrees.forEach((inDegree, col) => {
      if (inDegree === 0) {
        // in-degree = 0 means we start traversing from this node
        queue.push(col);
      }
    });
    // init count of visited vertices
    let visited = 0;
    // BFS
    while (queue.length !== 0) {
      // remove a vertex from the queue
      const src = queue.shift();
      // if this node has neighbours, increase visited by 1
      const neighbours = adj.get(src) || new Set();
      if (neighbours.size > 0) {
        visited += 1;
      }
      // iterate each neighbouring nodes
      neighbours.forEach((neighbour: string) => {
        // decrease in-degree of its neighbours by 1
        inDegrees.set(neighbour, inDegrees.get(neighbour) - 1);
        // if in-degree becomes 0
        if (inDegrees.get(neighbour) === 0) {
          // then put the neighboring node to the queue
          queue.push(neighbour);
        }
      });
    }
    // vertices not same as visited = cycle found
    if (vertices !== visited) {
      throw new FormulaError(
        FormulaErrorType.CIRCULAR_REFERENCE,
        {
          key: 'msg.formula.cantSaveCircularReference',
        },
        'Circular reference detected'
      );
    }
  }
}
