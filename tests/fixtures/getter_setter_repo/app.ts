class Box {
  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = v;
  }

  plain(): number {
    return 1;
  }

  useIt(): number {
    return this.value();
  }
}
