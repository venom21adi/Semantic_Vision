import * as path from "path";
import { helper } from "./helper";

export class Service {
  run(value: number): number {
    const result = helper(value);
    return path.resolve(String(result));
  }

  execute(value: number): number {
    return this.run(value);
  }
}

function logged(target: unknown, context: unknown) {
  return target;
}

export class Standalone {
  @logged
  value(x: number): number {
    return x;
  }
}
