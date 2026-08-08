import { describe, expect, it } from "vitest";
import { parseModel, type EvnexModelInfo } from "../src/models.js";

describe("parseModel", () => {
  describe("E2-series models", () => {
    it("parses E2C-25VO correctly", () => {
      const result = parseModel("E2C-25VO");
      expect(result).toEqual({
        name: "E2 Core",
        connector: "Type 2",
        cableLength: "5 metres",
        colour: "Volcanic",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("parses E2-18SN correctly", () => {
      const result = parseModel("E2-18SN");
      expect(result).toEqual({
        name: "E2 Plus",
        connector: "Type 1",
        cableLength: "8 metres",
        colour: "Snow",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("parses E2C-25ST correctly", () => {
      const result = parseModel("E2C-25ST");
      expect(result).toEqual({
        name: "E2 Core",
        connector: "Type 2",
        cableLength: "5 metres",
        colour: "Stone",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("parses E2C-28SA correctly", () => {
      const result = parseModel("E2C-28SA");
      expect(result).toEqual({
        name: "E2 Core",
        connector: "Type 2",
        cableLength: "8 metres",
        colour: "Sand",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("uses prefix as name when not in NAME_MAP_E2", () => {
      const result = parseModel("E2X-25VO");
      expect(result.name).toBe("E2X");
      expect(result.connector).toBe("Type 2");
      expect(result.cableLength).toBe("5 metres");
      expect(result.colour).toBe("Volcanic");
    });

    it("uses connector digit as connector when not in CONNECTOR_MAP", () => {
      const result = parseModel("E2C-35VO");
      expect(result.connector).toBe("3");
      expect(result.cableLength).toBe("5 metres");
      expect(result.colour).toBe("Volcanic");
    });

    it("uses cable digit as cable_length when not in CABLE_MAP_E2", () => {
      const result = parseModel("E2C-23VO");
      expect(result.connector).toBe("Type 2");
      expect(result.cableLength).toBe("3");
      expect(result.colour).toBe("Volcanic");
    });

    it("uses colour code as colour when not in COLOUR_MAP", () => {
      const result = parseModel("E2C-25XX");
      expect(result.connector).toBe("Type 2");
      expect(result.cableLength).toBe("5 metres");
      expect(result.colour).toBe("XX");
    });

    it("returns all Unknown for E2 without dash separator", () => {
      const result = parseModel("E2C25VO");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for E2 with only prefix (no spec)", () => {
      const result = parseModel("E2C-");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for E2 with spec too short", () => {
      const result = parseModel("E2C-2");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });
  });

  describe("X-series models", () => {
    it("parses X7-T2S-G correctly", () => {
      const result = parseModel("X7-T2S-G");
      expect(result).toEqual({
        name: "X7",
        connector: "Type 2",
        cableLength: "N/A",
        colour: "Grey",
        power: "7 kW",
        powerSensor: "External PS",
        configuration: "Socket",
      });
    });

    it("parses X22-P1T-W correctly", () => {
      const result = parseModel("X22-P1T-W");
      expect(result).toEqual({
        name: "X22",
        connector: "Type 1",
        cableLength: "N/A",
        colour: "White",
        power: "22 kW",
        powerSensor: "Onboard PS",
        configuration: "Tether",
      });
    });

    it("parses X7-T2S-W correctly", () => {
      const result = parseModel("X7-T2S-W");
      expect(result).toEqual({
        name: "X7",
        connector: "Type 2",
        cableLength: "N/A",
        colour: "White",
        power: "7 kW",
        powerSensor: "External PS",
        configuration: "Socket",
      });
    });

    it("uses power key as power when not in POWER_MAP", () => {
      const result = parseModel("X44-T2S-G");
      expect(result.power).toBe("44");
      expect(result.name).toBe("X44");
    });

    it("uses first spec char as powerSensor when not in PS_MAP", () => {
      const result = parseModel("X7-X2S-G");
      expect(result.powerSensor).toBe("X");
      expect(result.connector).toBe("Type 2");
    });

    it("uses second spec char as connector when not in CONNECTOR_MAP", () => {
      const result = parseModel("X7-T3S-G");
      expect(result.connector).toBe("3");
      expect(result.powerSensor).toBe("External PS");
    });

    it("uses third spec char as configuration when not in CONFIG_MAP", () => {
      const result = parseModel("X7-T2X-G");
      expect(result.configuration).toBe("X");
      expect(result.powerSensor).toBe("External PS");
    });

    it("uses colour first char when not in COLOUR_MAP", () => {
      const result = parseModel("X7-T2S-Z");
      expect(result.colour).toBe("Z");
    });

    it("returns all Unknown for X without proper split", () => {
      const result = parseModel("X7T2SG");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for X with too few parts", () => {
      const result = parseModel("X7-T2S");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for X with only prefix", () => {
      const result = parseModel("X7");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for X with empty parts", () => {
      const result = parseModel("X7--G");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });
  });

  describe("E7-series models", () => {
    it("parses E7-T2S-WC correctly with power as 7 (not 7 kW)", () => {
      const result = parseModel("E7-T2S-WC");
      expect(result).toEqual({
        name: "E7",
        connector: "Type 2",
        cableLength: "N/A",
        colour: "White",
        power: "7", // Deliberate upstream asymmetry
        powerSensor: "N/A",
        configuration: "Socket",
      });
    });

    it("parses E7-T2T-WC correctly", () => {
      const result = parseModel("E7-T2T-WC");
      expect(result).toEqual({
        name: "E7",
        connector: "Type 2",
        cableLength: "N/A",
        colour: "White",
        power: "7",
        powerSensor: "N/A",
        configuration: "Tether",
      });
    });

    it("parses E7-T1T-WC correctly", () => {
      const result = parseModel("E7-T1T-WC");
      expect(result).toEqual({
        name: "E7",
        connector: "Type 1",
        cableLength: "N/A",
        colour: "White",
        power: "7",
        powerSensor: "N/A",
        configuration: "Tether",
      });
    });

    it("uses second spec char as connector when not in CONNECTOR_MAP", () => {
      const result = parseModel("E7-T3S-G");
      expect(result.connector).toBe("3");
      expect(result.configuration).toBe("Socket");
    });

    it("uses third spec char as configuration when not in CONFIG_MAP", () => {
      const result = parseModel("E7-T2X-G");
      expect(result.configuration).toBe("X");
      expect(result.connector).toBe("Type 2");
    });

    it("uses colour first char when not in COLOUR_MAP", () => {
      const result = parseModel("E7-T2S-Z");
      expect(result.colour).toBe("Z");
    });

    it("returns all Unknown for E7 without proper split", () => {
      const result = parseModel("E7T2SG");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for E7 with too few parts", () => {
      const result = parseModel("E7-T2S");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for E7 with only prefix", () => {
      const result = parseModel("E7");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });
  });

  describe("unknown series", () => {
    it("returns all Unknown for unrecognized series", () => {
      const result = parseModel("Z9-T2S-G");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for empty string", () => {
      const result = parseModel("");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("returns all Unknown for random string", () => {
      const result = parseModel("RANDOMMODEL");
      expect(result).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });
  });

  describe("field structure", () => {
    it("returns object with all required fields for any valid E2 model", () => {
      const result = parseModel("E2C-25VO");
      expect(Object.keys(result).sort()).toEqual([
        "cableLength",
        "colour",
        "configuration",
        "connector",
        "name",
        "power",
        "powerSensor",
      ]);
    });

    it("returns object with all required fields for any valid X model", () => {
      const result = parseModel("X7-T2S-G");
      expect(Object.keys(result).sort()).toEqual([
        "cableLength",
        "colour",
        "configuration",
        "connector",
        "name",
        "power",
        "powerSensor",
      ]);
    });

    it("returns object with all required fields for any valid E7 model", () => {
      const result = parseModel("E7-T2S-WC");
      expect(Object.keys(result).sort()).toEqual([
        "cableLength",
        "colour",
        "configuration",
        "connector",
        "name",
        "power",
        "powerSensor",
      ]);
    });

    it("returns object with all required fields for unknown model", () => {
      const result = parseModel("INVALID");
      expect(Object.keys(result).sort()).toEqual([
        "cableLength",
        "colour",
        "configuration",
        "connector",
        "name",
        "power",
        "powerSensor",
      ]);
    });
  });

  describe("table-driven comprehensive coverage", () => {
    const testCases: Array<{
      input: string;
      expected: EvnexModelInfo;
      description: string;
    }> = [
      // E2 series
      {
        input: "E2C-25VO",
        expected: {
          name: "E2 Core",
          connector: "Type 2",
          cableLength: "5 metres",
          colour: "Volcanic",
          power: "N/A",
          powerSensor: "N/A",
          configuration: "N/A",
        },
        description: "E2C-25VO (E2 Core, Type 2, 5m, Volcanic)",
      },
      {
        input: "E2-18SN",
        expected: {
          name: "E2 Plus",
          connector: "Type 1",
          cableLength: "8 metres",
          colour: "Snow",
          power: "N/A",
          powerSensor: "N/A",
          configuration: "N/A",
        },
        description: "E2-18SN (E2 Plus, Type 1, 8m, Snow)",
      },
      // X series
      {
        input: "X7-T2S-G",
        expected: {
          name: "X7",
          connector: "Type 2",
          cableLength: "N/A",
          colour: "Grey",
          power: "7 kW",
          powerSensor: "External PS",
          configuration: "Socket",
        },
        description: "X7-T2S-G (X7, Type 2, 7kW, External PS, Socket, Grey)",
      },
      {
        input: "X22-P1T-W",
        expected: {
          name: "X22",
          connector: "Type 1",
          cableLength: "N/A",
          colour: "White",
          power: "22 kW",
          powerSensor: "Onboard PS",
          configuration: "Tether",
        },
        description: "X22-P1T-W (X22, Type 1, 22kW, Onboard PS, Tether, White)",
      },
      // E7 series
      {
        input: "E7-T2S-WC",
        expected: {
          name: "E7",
          connector: "Type 2",
          cableLength: "N/A",
          colour: "White",
          power: "7",
          powerSensor: "N/A",
          configuration: "Socket",
        },
        description:
          "E7-T2S-WC (E7, Type 2, 7 [not 7kW!], Socket, White) - asymmetry preserved",
      },
    ];

    testCases.forEach(({ input, expected, description }) => {
      it(`parses ${description}`, () => {
        expect(parseModel(input)).toEqual(expected);
      });
    });
  });

  describe("all lookup table values are recognized", () => {
    it("recognizes all CONNECTOR_MAP values", () => {
      expect(parseModel("E2C-15VO").connector).toBe("Type 1");
      expect(parseModel("E2C-25VO").connector).toBe("Type 2");
      expect(parseModel("X7-T1S-G").connector).toBe("Type 1");
      expect(parseModel("X7-T2S-G").connector).toBe("Type 2");
      expect(parseModel("E7-T1S-G").connector).toBe("Type 1");
      expect(parseModel("E7-T2S-G").connector).toBe("Type 2");
    });

    it("recognizes all NAME_MAP_E2 values", () => {
      expect(parseModel("E2-18SN").name).toBe("E2 Plus");
      expect(parseModel("E2C-25VO").name).toBe("E2 Core");
    });

    it("recognizes all CABLE_MAP_E2 values", () => {
      expect(parseModel("E2C-25VO").cableLength).toBe("5 metres");
      expect(parseModel("E2C-28VO").cableLength).toBe("8 metres");
    });

    it("recognizes all COLOUR_MAP values", () => {
      expect(parseModel("E2C-25SN").colour).toBe("Snow");
      expect(parseModel("E2C-25ST").colour).toBe("Stone");
      expect(parseModel("E2C-25SA").colour).toBe("Sand");
      expect(parseModel("E2C-25VO").colour).toBe("Volcanic");
      expect(parseModel("X7-T2S-W").colour).toBe("White");
      expect(parseModel("X7-T2S-G").colour).toBe("Grey");
      expect(parseModel("E7-T2S-W").colour).toBe("White");
      expect(parseModel("E7-T2S-G").colour).toBe("Grey");
    });

    it("recognizes all POWER_MAP values", () => {
      expect(parseModel("X7-T2S-G").power).toBe("7 kW");
      expect(parseModel("X22-P1T-W").power).toBe("22 kW");
    });

    it("recognizes all PS_MAP values", () => {
      expect(parseModel("X7-T2S-G").powerSensor).toBe("External PS");
      expect(parseModel("X7-P2S-G").powerSensor).toBe("Onboard PS");
    });

    it("recognizes all CONFIG_MAP values", () => {
      expect(parseModel("X7-T2S-G").configuration).toBe("Socket");
      expect(parseModel("X7-T2T-G").configuration).toBe("Tether");
      expect(parseModel("E7-T2S-G").configuration).toBe("Socket");
      expect(parseModel("E7-T2T-G").configuration).toBe("Tether");
    });
  });

  describe("edge cases for branch coverage", () => {
    it("exercises E7 spec length validation (too short spec)", () => {
      expect(parseModel("E7-T-W")).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("exercises E7 spec length validation (too short colour)", () => {
      expect(parseModel("E7-T2S-")).toEqual({
        name: "Unknown",
        connector: "Unknown",
        cableLength: "Unknown",
        colour: "Unknown",
        power: "N/A",
        powerSensor: "N/A",
        configuration: "N/A",
      });
    });

    it("exercises X series with all fallback lookups", () => {
      // Test X series with unrecognized values in each field
      const result = parseModel("X99-X9X-Z");
      expect(result.name).toBe("X99");
      expect(result.power).toBe("99"); // Not in POWER_MAP
      expect(result.powerSensor).toBe("X"); // Not in PS_MAP
      expect(result.connector).toBe("9"); // Not in CONNECTOR_MAP
      expect(result.configuration).toBe("X"); // Not in CONFIG_MAP
      expect(result.colour).toBe("Z"); // Not in COLOUR_MAP
    });

    it("exercises E7 series with all fallback lookups", () => {
      // Test E7 series with unrecognized values in each field
      const result = parseModel("E7-X9X-Z");
      expect(result.name).toBe("E7");
      expect(result.power).toBe("7"); // Always "7" for E7
      expect(result.connector).toBe("9"); // Not in CONNECTOR_MAP
      expect(result.configuration).toBe("X"); // Not in CONFIG_MAP
      expect(result.colour).toBe("Z"); // Not in COLOUR_MAP
      expect(result.powerSensor).toBe("N/A"); // Always "N/A" for E7
    });
  });
});
