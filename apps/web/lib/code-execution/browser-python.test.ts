import { describe, expect, it } from "vitest";
import { packagesForPython } from "./browser-python";

describe("browser Python package detection", () => {
  it("loads only approved packages referenced by imports", () => {
    expect(
      packagesForPython(`
import numpy as np
from pandas import DataFrame
import os
from sklearn.linear_model import LinearRegression
      `),
    ).toEqual(["numpy", "pandas", "scikit-learn"]);
  });

  it("deduplicates imports and ignores comments and arbitrary package names", () => {
    expect(
      packagesForPython(`
# import scipy
import sympy
from sympy import symbols
import definitely_not_installed
      `),
    ).toEqual(["sympy"]);
  });
});
