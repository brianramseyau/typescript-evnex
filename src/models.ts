/**
 * Charger model-code parsing — ported from `evnex/models.py`.
 *
 * ⚠ No upstream tests exist for this module (PLAN.md §6.3) — A2's tests are
 * the first verification this logic has ever had.
 */

export interface EvnexModelInfo {
  name: string;
  connector: string;
  cableLength: string;
  colour: string;
  /** Only for X-series (and "7" — not "7 kW" — for E7-series). */
  power: string;
  /** Only for X-series. */
  powerSensor: string;
  /** Only for X-series. */
  configuration: string;
}

// Lookup tables
const CONNECTOR_MAP: Record<string, string> = {
  "1": "Type 1",
  "2": "Type 2",
};

const NAME_MAP_E2: Record<string, string> = {
  E2: "E2 Plus",
  E2C: "E2 Core",
};

const CABLE_MAP_E2: Record<string, string> = {
  "5": "5 metres",
  "8": "8 metres",
};

const COLOUR_MAP: Record<string, string> = {
  SN: "Snow",
  ST: "Stone",
  SA: "Sand",
  VO: "Volcanic",
  W: "White",
  G: "Grey",
};

const POWER_MAP: Record<string, string> = {
  "7": "7 kW",
  "22": "22 kW",
};

const PS_MAP: Record<string, string> = {
  T: "External PS",
  P: "Onboard PS",
};

const CONFIG_MAP: Record<string, string> = {
  S: "Socket",
  T: "Tether",
};

/**
 * Parse either an E2-series, X-series, or E7-series model id.
 *
 * Returns an `EvnexModelInfo` with all fields set to "Unknown" for unrecognized
 * series or malformed input that fails to split correctly.
 *
 * Note: The E7-series deliberately sets `power: "7"` (not `"7 kW"`), mirroring
 * an asymmetry in the upstream Python implementation. This is preserved as-is.
 */
export function parseModel(modelId: string): EvnexModelInfo {
  if (modelId.startsWith("E2")) {
    // Handle E2 Series (e.g., E2C-25VO)
    try {
      const parts = modelId.split("-", 2);
      if (parts.length < 2) {
        return {
          name: "Unknown",
          connector: "Unknown",
          cableLength: "Unknown",
          colour: "Unknown",
          power: "N/A",
          powerSensor: "N/A",
          configuration: "N/A",
        };
      }

      const prefix = parts[0]!;
      const spec = parts[1]!;

      const name = NAME_MAP_E2[prefix] ?? prefix;
      const connector = CONNECTOR_MAP[spec.charAt(0)] ?? spec.charAt(0);
      const cableLength = CABLE_MAP_E2[spec.charAt(1)] ?? spec.charAt(1);
      const colour = COLOUR_MAP[spec.slice(-2)] ?? spec.slice(-2);

      return {
        name,
        connector,
        cableLength,
        colour,
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      };
    } catch {
      return {
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      };
    }
  }

  if (modelId.startsWith("X")) {
    // Handle X Series (e.g., X7-T2S-G)
    try {
      const parts = modelId.split("-", 3);
      if (parts.length !== 3) {
        return {
          name: "Unknown",
          connector: "Unknown",
          cableLength: "Unknown",
          colour: "Unknown",
          power: "N/A",
          powerSensor: "N/A",
          configuration: "N/A",
        };
      }

      const series = parts[0]!;
      const spec = parts[1]!;
      const colourStr = parts[2]!;

      // Extract power rating (X7, X22, etc.)
      const powerKey = series.slice(1); // e.g. "7" or "22"
      const power = POWER_MAP[powerKey] ?? powerKey;

      // First char = Power Sensor (T or P)
      const powerSensor = PS_MAP[spec.charAt(0)] ?? spec.charAt(0);

      // Second char = Connector type (1 or 2)
      const connector = CONNECTOR_MAP[spec.charAt(1)] ?? spec.charAt(1);

      // Third char = Configuration (S or T)
      const configuration = CONFIG_MAP[spec.charAt(2)] ?? spec.charAt(2);

      // First char of colour = Colour (W or G)
      const colour = COLOUR_MAP[colourStr.charAt(0)] ?? colourStr.charAt(0);

      return {
        name: series,
        connector,
        cableLength: "N/A",
        colour,
        power,
        powerSensor,
        configuration,
      };
    } catch {
      return {
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      };
    }
  }

  if (modelId.startsWith("E7")) {
    // Handle E7-series (discontinued chargers, e.g., E7-T2S-WC)
    try {
      const parts = modelId.split("-", 3);
      if (parts.length !== 3) {
        return {
          name: "Unknown",
          connector: "Unknown",
          cableLength: "Unknown",
          colour: "Unknown",
          power: "N/A",
          powerSensor: "N/A",
          configuration: "N/A",
        };
      }

      const series = parts[0]!;
      const spec = parts[1]!;
      const colourStr = parts[2]!;

      // Second char = Connector type (1 or 2)
      const connector = CONNECTOR_MAP[spec.charAt(1)] ?? spec.charAt(1);

      // Third char = Configuration (S or T)
      const configuration = CONFIG_MAP[spec.charAt(2)] ?? spec.charAt(2);

      // First char of colour = Colour (W or G)
      const colour = COLOUR_MAP[colourStr.charAt(0)] ?? colourStr.charAt(0);

      return {
        name: series,
        connector,
        cableLength: "N/A",
        colour,
        // Note: E7 branch deliberately uses "7" (not "7 kW") — upstream asymmetry
        power: "7",
        powerSensor: "N/A",
        configuration,
      };
    } catch {
      return {
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      };
    }
  }

  // Unknown series
  return {
    name: "Unknown",
    connector: "Unknown",
    cableLength: "Unknown",
    colour: "Unknown",
    power: "N/A",
    powerSensor: "N/A",
    configuration: "N/A",
  };
}
