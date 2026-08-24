import { formatName } from "./helper";
import * as path from "path";

export class Greeter {
  greet(name: string): string {
    const cleaned = this.clean(name);
    return path.join(cleaned, "greeting");
  }

  clean(name: string): string {
    return formatName(name);
  }
}
