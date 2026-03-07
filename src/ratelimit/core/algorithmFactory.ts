import { RateLimitAlgorithm } from "./rateLimitAlgorithm"
import { FixedWindow } from "../algorithms/fixedWindow"
import { RateLimiterBackend } from "./rateLimiterBackend"

export type AlgorithmType =
  | "fixed_window"

export class AlgorithmFactory {

  static create(
    type: AlgorithmType,
    backend: RateLimiterBackend,
    config: any
  ): RateLimitAlgorithm {

    switch (type) {

      case "fixed_window":
        return new FixedWindow(
          backend,
          config.capacity,
          config.windowMs
        )

      default:
        throw new Error("Unknown algorithm")

    }

  }

}