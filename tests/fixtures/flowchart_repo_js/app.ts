function simpleBranch(x: number): number {
  let y: number;
  if (x > 0) {
    y = 1;
  } else {
    y = -1;
  }
  return y;
}

function nestedBranchInLoop(items: number[]): number {
  let total = 0;
  for (const item of items) {
    if (item > 0) {
      total += item;
    }
  }
  return total;
}

function whileWithBreakContinue(n: number): number {
  let i = 0;
  while (i < n) {
    i++;
    if (i === 5) {
      continue;
    }
    if (i === 8) {
      break;
    }
    console.log(i);
  }
  return i;
}

function doWhileLoop(n: number): number {
  let i = 0;
  do {
    i++;
  } while (i < n);
  return i;
}

function forInLoop(obj: Record<string, number>): void {
  for (const key in obj) {
    console.log(key);
  }
}

function switchWithFallthrough(v: number): string {
  switch (v) {
    case 1:
      doOne();
      break;
    case 2:
    case 3:
      doTwo();
    default:
      doDefault();
  }
  return "done";
}

function switchNoDefault(v: number): void {
  switch (v) {
    case 1:
      doOne();
  }
  after();
}

function labeledBreakContinue(matrix: number[][]): void {
  outer: for (const row of matrix) {
    for (const cell of row) {
      if (cell === 0) {
        continue outer;
      }
      if (cell < 0) {
        break outer;
      }
    }
  }
}

function multipleReturns(x: number): string {
  if (x < 0) {
    return "negative";
  }
  if (x === 0) {
    return "zero";
  }
  return "positive";
}

function elifChain(x: number): string {
  if (x < 0) {
    return "negative";
  } else if (x === 0) {
    return "zero";
  } else {
    return "positive";
  }
}

function noExplicitReturn(items: number[]): void {
  for (const item of items) {
    console.log(item);
  }
}

function addOne(x: number): number {
  return x + 1;
}

function callsSameFileFunction(x: number): number {
  addOne(x);
  return x;
}

function callsExternalFunction(): void {
  Math.max(1, 2);
}

class Alpha {
  helper(): number {
    return 1;
  }
}

class Beta {
  helper(): number {
    return 2;
  }
}

function callsAmbiguousMethod(obj: Alpha | Beta): void {
  obj.helper();
}

const conciseArrow = (x: number) => x + 1;

function withTryCatchFinally(): number {
  try {
    risky();
  } catch (e) {
    handle(e);
  } finally {
    cleanup();
  }
  return 1;
}

function switchWithBracedCase(v: number): string {
  switch (v) {
    case 1: {
      let x = 1;
      doOne();
      break;
    }
    case 2:
      doTwo();
      break;
    default:
      doDefault();
  }
  return "done";
}

function bareBlockWithConditionalReturn(x: number): number {
  {
    let y = x + 1;
    if (y > 0) {
      return y;
    }
  }
  return -1;
}

function switchInsideLoop(items: number[]): void {
  for (const item of items) {
    switch (item) {
      case 1:
        doOne();
        break;
      default:
        doDefault();
    }
    after();
  }
}

function doOne() {}
function doTwo() {}
function doDefault() {}
function after() {}
function risky() {}
function handle(e: unknown) {}
function cleanup() {}
