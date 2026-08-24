export function trivial(): number {
  return 1;
}

export function nestedIfElseIf(x: number): number {
  if (x > 0) {
    return 1;
  } else if (x < 0) {
    return -1;
  } else {
    return 0;
  }
}

export function loopWithBooleanCondition(items: number[]): number {
  let total = 0;
  for (const item of items) {
    if (item > 0 && item < 100) {
      total += item;
    }
  }
  return total;
}

export function nestedLoop(matrix: number[][]): number {
  let total = 0;
  for (const row of matrix) {
    for (const cell of row) {
      total += cell;
    }
  }
  return total;
}

export function forInLoop(obj: Record<string, number>): number {
  let total = 0;
  for (const key in obj) {
    total += obj[key];
  }
  return total;
}

export function switchExample(value: number): string {
  switch (value) {
    case 1:
      return "one";
    case 2:
      return "two";
    default:
      return "other";
  }
}

export function ternaryExpression(x: number): number {
  return x > 0 ? 1 : -1;
}

export async function asyncWithDecision(items: AsyncIterable<number>): Promise<number> {
  let total = 0;
  for await (const item of items) {
    if (item > 0) {
      total += item;
    }
  }
  return total;
}

export function tryCatchExample(x: number): number {
  try {
    return 1 / x;
  } catch (e) {
    return 0;
  }
}

export function whileAndDoWhile(x: number): number {
  while (x > 0) {
    x -= 1;
  }
  do {
    x += 1;
  } while (x < 10);
  return x;
}

export function siblingLoops(itemsA: number[], itemsB: number[]): number {
  let total = 0;
  for (const a of itemsA) {
    total += a;
  }
  for (const b of itemsB) {
    total += b;
  }
  return total;
}

export function tripleLogicalChain(a: boolean, b: boolean, c: boolean): boolean {
  return a && b && c;
}

export function nullishAndLogicalAssignment(a: number | null, b: number): number {
  const x = a ?? b;
  let y = 1;
  y ??= 2;
  y ||= 3;
  y &&= 4;
  return x + y;
}

export function callbackBranchingFlattensIntoEnclosing(items: number[]): number[] {
  return items.filter((item) => {
    if (item > 0) {
      return true;
    }
    return false;
  });
}

export function namedNestedFunctionDoesNotInflateEnclosing(): number {
  function helper(x: number): number {
    if (x > 0) {
      return 1;
    }
    return -1;
  }
  return helper(1);
}

export function chainStep0(): number {
  return chainStep1();
}

export function chainStep1(): number {
  return chainStep2();
}

export function chainStep2(): number {
  return chainStep3();
}

export function chainStep3(): number {
  return chainStep4();
}

export function chainStep4(): number {
  return chainStep5();
}

export function chainStep5(): number {
  return chainStep6();
}

export function chainStep6(): number {
  return 42;
}

export function cyclic0(): number {
  return cyclic1();
}

export function cyclic1(): number {
  return cyclic2();
}

export function cyclic2(): number {
  return cyclic3();
}

export function cyclic3(): number {
  return cyclic4();
}

export function cyclic4(): number {
  return cyclic5();
}

export function cyclic5(): number {
  return cyclic6();
}

export function cyclic6(): number {
  return cyclic7();
}

export function cyclic7(): number {
  return cyclic0();
}
