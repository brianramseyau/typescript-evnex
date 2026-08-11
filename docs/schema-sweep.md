# Schema sweep report

- **Mode:** live
- **Generated:** 2026-08-11T02:43:22.961Z
- **Org id:** `<redacted:orgId>`
- **Charge point id:** `<redacted:chargePointId>`
- **Endpoints captured:** 14

## Summary

| Endpoint | Method | Path | Outcome | Extra | Missing | Mismatches |
|---|---|---|---|---|---|---|
| `userDetail` | GET | `/v2/apps/user` | ✅ parsed cleanly | 0 | 0 | 0 |
| `orgChargePoints` | GET | `/v2/apps/organisations/{orgId}/charge-points` | ✅ parsed cleanly | 1 | 0 | 0 |
| `chargePointDetailV2` *(deprecated)* | GET | `/v2/apps/charge-points/{chargePointId}` | ⚠️ HTTP error (404) | 0 | 0 | 0 |
| `chargePointDetailV3` | GET | `/charge-points/{chargePointId}` | ✅ parsed cleanly | 2 | 0 | 0 |
| `chargePointStatus` | POST | `/charge-points/{chargePointId}/commands/get-status` | ✅ parsed cleanly | 0 | 0 | 0 |
| `chargePointEnergyMeterReading` | POST | `/charge-points/{chargePointId}/commands/get-energy-meter-reading` | ✅ parsed cleanly | 0 | 0 | 0 |
| `chargePointOverride` | POST | `/charge-points/{chargePointId}/commands/get-override` | ✅ parsed cleanly | 0 | 0 | 0 |
| `chargePointSolarConfig` | POST | `/charge-points/{chargePointId}/commands/get-solar` | ✅ parsed cleanly | 0 | 0 | 0 |
| `chargePointTransactionsV2` *(deprecated)* | GET | `/v2/apps/charge-points/{chargePointId}/transactions` | ⚠️ HTTP error (404) | 0 | 0 | 0 |
| `chargePointSessions` | GET | `/charge-points/{chargePointId}/sessions` | ✅ parsed cleanly | 92 | 0 | 0 |
| `orgLocations` | GET | `/v2/apps/organisations/{orgId}/locations` | ✅ parsed cleanly | 4 | 0 | 0 |
| `orgInsight` | GET | `/organisations/{orgId}/summary/insights` | ✅ parsed cleanly | 1 | 0 | 0 |
| `orgSummaryStatusV2` | GET | `/v2/apps/organisations/{orgId}/summary/status` | ⚠️ HTTP error (404) | 0 | 0 | 0 |
| `orgConnectorSummaryV3` | GET | `/organisations/{orgId}/summary/status` | ✅ parsed cleanly | 0 | 0 | 0 |

## Endpoint detail

### `orgChargePoints` — Org charge points (v2, flat envelope)

- **Method / path template:** `GET /v2/apps/organisations/{orgId}/charge-points`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
- `data.items[0].metadata`

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePoint — connectors/lastHeard optional (`| None = None`) in both; maxCurrent/tokenRequired/needsRegistrationInformation required in both. No known divergence.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "items": [
      {
        "connectors": [
          {
            "amperage": 32,
            "connectorFormat": "CABLE",
            "connectorId": "<redacted:id>",
            "connectorType": "IEC_62196_T2",
            "evseId": "<redacted:id>",
            "meter": {
              "frequency": 49.98,
              "power": 0,
              "powerType": "AC_1_PHASE",
              "register": 719850,
              "updatedDate": "2026-08-06T21:55:00.000Z"
            },
            "ocppCode": "NoError",
            "status": "",
            "ocppStatus": "AVAILABLE",
            "powerType": "AC_1_PHASE",
            "updatedDate": "2026-02-15T20:24:12.852Z",
            "voltage": 240
          }
        ],
        "createdDate": "2026-02-15T20:24:12.852Z",
        "maxCurrent": 30,
        "tokenRequired": false,
        "needsRegistrationInformation": false,
        "details": {
          "firmware": "2.8.6.168A096",
          "model": "E2F-25VO",
          "vendor": "Evnex"
        },
        "id": "<redacted:id>",
        "ocppChargePointId": "<redacted:id>",
        "metadata": {},
        "name": "<redacted:name>",
        "networkStatus": "ONLINE",
        "serial": "<redacted:serial>",
        "networkStatusUpdatedDate": "2026-08-11T02:40:02.436Z",
        "updatedDate": "2026-08-05T08:51:04.045Z",
        "location": {
          "address": {
            "address1": "<redacted:address>",
            "address2": "<redacted:address>",
            "address3": "<redacted:address>",
            "city": "<redacted:address>",
            "postCode": "<redacted:address>",
            "state": "<redacted:address>",
            "country": "AU"
          },
          "coordinates": {
            "latitude": "<redacted:coordinate>",
            "longitude": "<redacted:coordinate>"
          },
          "chargePointCount": 1,
          "id": "<redacted:id>",
          "updatedDate": "2026-03-02T06:20:49.591Z",
          "createdDate": "2026-03-02T05:00:56.649Z",
          "name": "<redacted:name>"
        }
      }
    ]
  }
}
```

</details>
### `chargePointDetailV2` — Charge point detail (v2, deprecated) (deprecated)

- **Method / path template:** `GET /v2/apps/charge-points/{chargePointId}`
- **Outcome:** ⚠️ HTTP error (404)
- **HTTP status:** 404
- **Note:** HTTP 404

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- *** TOP PRIORITY — no live fixture exists for this endpoint in either python-evnex or this project (PARITY.md's EvnexChargePointDetail (v2) row says so explicitly). This is the sweep's main reason to exist. ***
- evnex/schema/charge_points.py: EvnexChargePointDetail(EvnexChargePointBase) — configuration, electricityCost, loadSchedule, and connectors (a plain, non-optional list, unlike EvnexChargePoint's optional connectors) are ALL required with no default in Python. The port preserves that requiredness exactly (has not loosened anything to compensate for the missing fixture).
- evnex/schema/charge_points.py: EvnexChargePointLoadSchedule.timezone is `str` (required, no default) in Python — this is the confirmed §10.1 upstream bug (the live API omits it from every load-schedule response). Our EvnexChargePointLoadSchedule.timezone is .nullish() (deliberate fix, see src/schema/chargePoints.ts's comment). If this capture's loadSchedule is present, check whether `timezone` is actually absent — that is the live confirmation §10.1 predicted but never had.
- If this endpoint 404s, times out, or otherwise fails outright: that is itself a finding worth recording (deprecated endpoints sometimes get withdrawn entirely) — capture it as such, do not treat a hard failure here as a tooling bug.

<details><summary>Redacted response body</summary>

```text
{"errors":[{"status":"404","title":"NotFoundError"}]}
```

</details>
### `chargePointDetailV3` — Charge point detail (v3, JSON:API envelope)

- **Method / path template:** `GET /charge-points/{chargePointId}`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
- `data.attributes.allowLongTermOfflineCharging`
- `data.attributes.chargingConfiguration`

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/v3/charge_points.py: EvnexChargePointDetail — timeZone required (no default) in both; connectionConfiguration/features/iccid/isSolarEnabled optional in both. No known divergence on the attributes object itself.
- evnex/schema/v3/generic.py: EvnexV3APIResponse.included — Python's `list[EvnexV3Include] | None` has NO `= None` default, which under pydantic v2 semantics makes the *key* required (nullable, but must be present). Our evnexV3ApiResponse's `included` is `.nullish()` — optional AND nullable, strictly more lenient. Check this capture's raw body for whether the top-level `included` key is present at all (even as `null`) — PARITY.md's 'Defects found but not fixed' #1 flags this as unverified against a live account.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "id": "<redacted:id>",
    "type": "chargePoints",
    "attributes": {
      "allowLongTermOfflineCharging": true,
      "chargingConfiguration": {
        "currency": "AUD",
        "tariffs": {
          "import": {
            "Flat": {
              "type": "TIME_OF_USE",
              "amount": "0.2943"
            }
          },
          "export": {
            "Solar": {
              "type": "TIME_OF_USE",
              "amount": "0"
            }
          }
        },
        "periods": {
          "day": [
            {
              "start": 0,
              "behaviour": {
                "type": "Charge"
              },
              "importTariff": "Flat"
            }
          ]
        },
        "repeats": "daily"
      },
      "connectionConfiguration": {
        "automaticallyManaged": true,
        "preferredConnectionType": "WiFi",
        "updatedDate": "2026-08-05T08:51:03.979Z",
        "wifiConnected": true
      },
      "connectors": [
        {
          "evseId": "<redacted:id>",
          "connectorFormat": "CABLE",
          "connectorType": "IEC_62196_T2",
          "ocppStatus": "AVAILABLE",
          "powerType": "AC_1_PHASE",
          "connectorId": "<redacted:id>",
          "ocppCode": "NoError",
          "updatedDate": "2026-02-15T20:24:12.852Z",
          "meter": {
            "currentL1": 0,
            "frequency": 49.98,
            "power": 0,
            "register": 719850,
            "supplyActivePower": 3766,
            "updatedDate": "2026-08-06T21:55:00.000Z",
            "voltageL1N": 232.5
          },
          "maxVoltage": 240,
          "maxAmperage": 32
        }
      ],
      "createdDate": "2026-02-15T20:24:12.852Z",
      "electricityCost": {
        "currency": "AUD",
        "tariffs": [
          {
            "start": 0,
            "rate": "0.3",
            "type": "Flat"
          }
        ],
        "tariffType": "Flat",
        "cost": 0.3
      },
      "features": {
        "PowerSensor": {
          "unlocked": true
        },
        "Solar": {
          "unlocked": false
        },
        "VehicleIntegration": {
          "unlocked": false
        }
      },
      "firmware": "2.8.6.168A096",
      "isSolarEnabled": false,
      "maxCurrent": 30,
      "model": "E2F-25VO",
      "name": "<redacted:name>",
      "networkStatus": "ONLINE",
      "networkStatusUpdatedDate": "2026-08-11T02:40:02.436Z",
      "ocppChargePointId": "<redacted:id>",
      "profiles": {},
      "serial": "<redacted:serial>",
      "timeZone": "Australia/Melbourne",
      "tokenRequired": false,
      "updatedDate": "2026-08-05T08:51:04.045Z",
      "vendor": "Evnex"
    },
    "relationships": {
      "location": {
        "data": {
          "id": "<redacted:id>",
          "type": "locations"
        }
      },
      "organisation": {
        "data": {
          "id": "<redacted:id>",
          "type": "organisations"
        }
      }
    }
  },
  "included": [
    {
      "id": "<redacted:id>",
      "type": "locations",
      "attributes": {
        "name": "<redacted:name>",
        "address": {
          "address1": "<redacted:address>",
          "address2": "<redacted:address>",
          "address3": "<redacted:address>",
          "city": "<redacted:address>",
          "postCode": "<redacted:address>",
          "state": "<redacted:address>",
          "country": "AU"
        },
        "coordinates": {
          "latitude": "<redacted:coordinate>",
          "longitude": "<redacted:coordinate>"
        },
        "isPublic": false,
        "updated": "2026-03-02T06:20:49.591Z",
        "created": "2026-03-02T05:00:56.649Z",
        "icpNumber": "<redacted:icpNumber>",
        "timeZone": "Australia/Melbourne"
      }
    }
  ]
}
```

</details>
### `chargePointTransactionsV2` — Charge point transactions (v2, deprecated) (deprecated)

- **Method / path template:** `GET /v2/apps/charge-points/{chargePointId}/transactions`
- **Outcome:** ⚠️ HTTP error (404)
- **HTTP status:** 404
- **Note:** HTTP 404

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePointTransaction — endDate/reason/carbonOffset/electricityCost optional in both; startDate required (no default) in both. No known divergence. Like the v2 detail endpoint, this is deprecated and may return nothing at all on an account with no history through it — a clean empty items:[] response, an HTTP error, or a timeout are all plausible and all informative.

<details><summary>Redacted response body</summary>

```text
{"errors":[{"status":"404","title":"NotFoundError"}]}
```

</details>
### `chargePointSessions` — Charge point sessions (v3, JSON:API envelope)

- **Method / path template:** `GET /charge-points/{chargePointId}/sessions`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
- `data[0].attributes.chargingConfiguration`
- `data[0].attributes.cost`
- `data[0].attributes.energyUsage`
- `data[0].attributes.transaction.id`
- `data[1].attributes.chargingConfiguration`
- `data[1].attributes.cost`
- `data[1].attributes.energyUsage`
- `data[1].attributes.transaction.id`
- `data[2].attributes.chargingConfiguration`
- `data[2].attributes.cost`
- `data[2].attributes.energyUsage`
- `data[2].attributes.transaction.id`
- `data[3].attributes.chargingConfiguration`
- `data[3].attributes.cost`
- `data[3].attributes.energyUsage`
- `data[3].attributes.transaction.id`
- `data[4].attributes.chargingConfiguration`
- `data[4].attributes.cost`
- `data[4].attributes.energyUsage`
- `data[4].attributes.transaction.id`
- `data[5].attributes.chargingConfiguration`
- `data[5].attributes.cost`
- `data[5].attributes.energyUsage`
- `data[5].attributes.transaction.id`
- `data[6].attributes.chargingConfiguration`
- `data[6].attributes.cost`
- `data[6].attributes.energyUsage`
- `data[6].attributes.transaction.id`
- `data[7].attributes.chargingConfiguration`
- `data[7].attributes.cost`
- `data[7].attributes.energyUsage`
- `data[7].attributes.transaction.id`
- `data[8].attributes.chargingConfiguration`
- `data[8].attributes.cost`
- `data[8].attributes.energyUsage`
- `data[8].attributes.transaction.id`
- `data[9].attributes.chargingConfiguration`
- `data[9].attributes.cost`
- `data[9].attributes.energyUsage`
- `data[9].attributes.transaction.id`
- `data[10].attributes.chargingConfiguration`
- `data[10].attributes.cost`
- `data[10].attributes.energyUsage`
- `data[10].attributes.transaction.id`
- `data[11].attributes.chargingConfiguration`
- `data[11].attributes.cost`
- `data[11].attributes.energyUsage`
- `data[11].attributes.transaction.id`
- `data[12].attributes.chargingConfiguration`
- `data[12].attributes.cost`
- `data[12].attributes.energyUsage`
- `data[12].attributes.transaction.id`
- `data[13].attributes.chargingConfiguration`
- `data[13].attributes.cost`
- `data[13].attributes.energyUsage`
- `data[13].attributes.transaction.id`
- `data[14].attributes.chargingConfiguration`
- `data[14].attributes.cost`
- `data[14].attributes.energyUsage`
- `data[14].attributes.transaction.id`
- `data[15].attributes.chargingConfiguration`
- `data[15].attributes.cost`
- `data[15].attributes.energyUsage`
- `data[15].attributes.transaction.id`
- `data[16].attributes.chargingConfiguration`
- `data[16].attributes.cost`
- `data[16].attributes.energyUsage`
- `data[16].attributes.transaction.id`
- `data[17].attributes.chargingConfiguration`
- `data[17].attributes.cost`
- `data[17].attributes.energyUsage`
- `data[17].attributes.transaction.id`
- `data[18].attributes.chargingConfiguration`
- `data[18].attributes.cost`
- `data[18].attributes.energyUsage`
- `data[18].attributes.transaction.id`
- `data[19].attributes.chargingConfiguration`
- `data[19].attributes.cost`
- `data[19].attributes.energyUsage`
- `data[19].attributes.transaction.id`
- `data[20].attributes.chargingConfiguration`
- `data[20].attributes.cost`
- `data[20].attributes.energyUsage`
- `data[20].attributes.transaction.id`
- `data[21].attributes.chargingConfiguration`
- `data[21].attributes.cost`
- `data[21].attributes.energyUsage`
- `data[21].attributes.transaction.id`
- `data[22].attributes.chargingConfiguration`
- `data[22].attributes.cost`
- `data[22].attributes.energyUsage`
- `data[22].attributes.transaction.id`

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/v3/charge_points.py: EvnexChargePointSessionAttributes — every one of the 17 fields is `= None` (optional) in Python, including startDate/sessionStatus; the port matches exactly (all .nullish()). No known divergence. This is the endpoint PLAN.md §10.3/§10.4 warn hardest against ever tightening.

<details><summary>Redacted response body</summary>

```json
{
  "data": [
    {
      "attributes": {
        "authorizationMethod": "NoTokenRequired",
        "chargingConfiguration": {
          "currency": "AUD",
          "tariffs": {
            "import": {
              "Flat": {
                "type": "TIME_OF_USE",
                "amount": "0.2943"
              }
            },
            "export": {
              "Solar": {
                "type": "TIME_OF_USE",
                "amount": "0"
              }
            }
          },
          "periods": {
            "day": [
              {
                "start": 0,
                "behaviour": {
                  "type": "Charge"
                },
                "importTariff": "Flat"
              }
            ]
          },
          "repeats": "daily"
        },
        "chargingStopped": "2026-08-06T21:56:31.000Z",
        "connectorId": "<redacted:id>",
        "cost": {
          "total": "0"
        },
        "createdDate": "2026-08-06T21:56:32.057Z",
        "electricityCost": {
          "currency": "AUD",
          "tariffs": [
            {
              "start": 0,
              "rate": "0.3",
              "type": "Flat"
            }
          ],
          "tariffType": "Flat"
        },
        "endDate": "2026-08-06T21:56:31.000Z",
        "energyUsage": {
          "total": 0
        },
        "evseId": "<redacted:id>",
        "sessionStatus": "Completed",
        "startDate": "2026-08-06T21:56:31.000Z",
        "totalChargingTime": 0,
        "totalCost": {
          "currency": "AUD",
          "amount": "0"
        },
        "totalDuration": 0,
        "totalEnergyUsage": {
          "total": 0
        },
        "totalPowerUsage": 0,
        "transaction": {
          "id": "<redacted:id>",
          "meterStart": 719849,
          "startDate": "2026-08-06T21:56:31.000Z",
          "meterStop": 719849,
          "endDate": "2026-08-06T21:56:31.000Z",
          "reason": "EVDisconnected"
        },
        "updatedDate": "2026-08-06T21:56:32.496Z"
      },
      "id": "<redacted:id>",
      "relationships": {
        "chargePoint": {
          "data": {
            "id": "<redacted:id>",
            "type": "chargePoints"
          }
        },
        "location": {
          "data": {
            "id": "<redacted:id>",
            "type": "locations"
          }
        },
        "organisation": {
          "data": {
            "id": "<redacted:id>",
            "type": "organisations"
          }
        }
      },
      "type": "sessions"
    },
    {
      "attributes": {
        "authorizationMethod": "NoTokenRequired",
        "chargingConfiguration": {
          "currency": "AUD",
          "tariffs": {
            "import": {
              "Flat": {
                "type": "TIME_OF_USE",
                "amount": "0.2943"
              }
            },
            "export": {
              "Solar": {
                "type": "TIME_OF_USE",
                "amount": "0"
              }
            }
          },
          "periods": {
            "day": [
              {
                "start": 0,
                "behaviour": {
                  "type": "Charge"
                },
                "importTariff": "Flat"
              }
            ]
          },
          "repeats": "daily"
        },
        "chargingStarted": "2026-08-06T06:25:30.000Z",
        "chargingStopped": "2026-08-06T21:40:05.000Z",
        "connectorId": "<redacted:id>",
        "cost": {
          "distributionByTariff": {
            "Flat": 100
          },
          "total": "21.9396"
        },
        "createdDate": "2026-08-06T06:25:40.458Z",
        "electricityCost": {
          "currency": "AUD",
          "tariffs": [
            {
              "start": 0,
              "rate": "0.3",
              "type": "Flat"
            }
          ],
          "tariffType": "Flat"
        },
        "endDate": "2026-08-06T21:56:31.000Z",
        "energyUsage": {
          "distributionByTariff": {
       
…(truncated)
```

</details>
### `orgLocations` — Org locations (v3, JSON:API envelope)

- **Method / path template:** `GET /v2/apps/organisations/{orgId}/locations`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
- `data[0].attributes.address.address3`
- `data[0].relationships.organisation`
- `data[0].relationships.users`
- `included`

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/v3/locations.py: EvnexLocationAttributes — only `name` required, all 8 others optional in both. EvnexLocationCoordinates.latitude/longitude are `str | None`, not float — the port deliberately keeps them as z.string().nullish() rather than 'correcting' them to numbers. No known divergence. Note: latitude/longitude are redacted in this capture's stored body regardless of their string/number wire type.

<details><summary>Redacted response body</summary>

```json
{
  "data": [
    {
      "id": "<redacted:id>",
      "type": "locations",
      "attributes": {
        "name": "<redacted:name>",
        "address": {
          "address1": "<redacted:address>",
          "address2": "<redacted:address>",
          "address3": "<redacted:address>",
          "city": "<redacted:address>",
          "postCode": "<redacted:address>",
          "state": "<redacted:address>",
          "country": "AU"
        },
        "coordinates": {
          "latitude": "<redacted:coordinate>",
          "longitude": "<redacted:coordinate>"
        },
        "isPublic": false,
        "updated": "2026-03-02T06:20:49.591Z",
        "created": "2026-03-02T05:00:56.649Z",
        "icpNumber": "<redacted:icpNumber>",
        "timeZone": "Factory"
      },
      "relationships": {
        "chargePoints": {
          "data": [
            {
              "type": "chargePoints",
              "id": "<redacted:id>"
            }
          ]
        },
        "organisation": {
          "data": null
        },
        "users": {
          "data": []
        }
      }
    }
  ],
  "included": [
    {
      "id": "<redacted:id>",
      "type": "chargePoints",
      "attributes": {
        "allowLongTermOfflineCharging": true,
        "chargingConfiguration": {
          "currency": "AUD",
          "tariffs": {
            "import": {
              "Flat": {
                "type": "TIME_OF_USE",
                "amount": "0.2943"
              }
            },
            "export": {
              "Solar": {
                "type": "TIME_OF_USE",
                "amount": "0"
              }
            }
          },
          "periods": {
            "day": [
              {
                "start": 0,
                "behaviour": {
                  "type": "Charge"
                },
                "importTariff": "Flat"
              }
            ]
          },
          "repeats": "daily"
        },
        "connectionConfiguration": {
          "automaticallyManaged": true,
          "preferredConnectionType": "WiFi",
          "updatedDate": "2026-08-05T08:51:03.979Z",
          "wifiConnected": true
        },
        "connectors": [
          {
            "evseId": "<redacted:id>",
            "connectorFormat": "CABLE",
            "connectorType": "IEC_62196_T2",
            "ocppStatus": "AVAILABLE",
            "powerType": "AC_1_PHASE",
            "connectorId": "<redacted:id>",
            "ocppCode": "NoError",
            "updatedDate": "2026-02-15T20:24:12.852Z",
            "meter": {
              "currentL1": 0,
              "frequency": 49.98,
              "power": 0,
              "register": 719850,
              "supplyActivePower": 3766,
              "updatedDate": "2026-08-06T21:55:00.000Z",
              "voltageL1N": 232.5
            },
            "maxVoltage": 240,
            "maxAmperage": 32
          }
        ],
        "createdDate": "2026-02-15T20:24:12.852Z",
        "electricityCost": {
          "currency": "AUD",
          "tariffs": [
            {
              "start": 0,
              "rate": "0.3",
              "type": "Flat"
            }
          ],
          "tariffType": "Flat",
          "cost": 0.3
        },
        "features": {
          "PowerSensor": {
            "unlocked": true
          },
          "Solar": {
            "unlocked": false
          },
          "VehicleIntegration": {
            "unlocked": false
          }
        },
        "firmware": "2.8.6.168A096",
        "isSolarEnabled": false,
        "maxCurrent": 30,
        "model": "E2F-25VO",
        "name": "<redacted:name>",
        "networkStatus": "ONLINE",
        "networkStatusUpdatedDate": "2026-08-11T02:43:19.667Z",
        "ocppChargePointId": "<redacted:id>",
        "profiles": {},
        "serial": "<redacted:serial>",
        "timeZone": "Australia/Melbourne",
        "tokenRequired": false,
        "updatedDate": "2026-08-05T08:51:04.045Z",
        "vendor": "Ev
…(truncated)
```

</details>
### `orgInsight` — Org insight (7-day)

- **Method / path template:** `GET /organisations/{orgId}/summary/insights`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
- `data[2].attributes.cost.AUD`

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/org.py: EvnexOrgInsightEntry — only carbonUsage optional in both; cost (nested EvnexCost) itself required in both, though EvnexCost's own 2 fields are optional. No known divergence.

<details><summary>Redacted response body</summary>

```json
{
  "data": [
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-04T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-05T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 22365,
        "carbonUsage": 51844.270000000026,
        "cost": {
          "AUD": {
            "distributionByImportTariffs": {
              "Flat": 100
            },
            "total": 21.9396
          }
        },
        "duration": 931,
        "powerUsage": 74549,
        "sessions": 2,
        "startDate": "2026-08-06T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-07T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-08T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-09T12:00:00.000Z"
      }
    },
    {
      "attributes": {
        "carbonOffset": 0,
        "cost": {},
        "duration": 0,
        "powerUsage": 0,
        "sessions": 0,
        "startDate": "2026-08-10T12:00:00.000Z"
      }
    }
  ]
}
```

</details>
### `orgSummaryStatusV2` — Org summary status (v2, flat)

- **Method / path template:** `GET /v2/apps/organisations/{orgId}/summary/status`
- **Outcome:** ⚠️ HTTP error (404)
- **HTTP status:** 404
- **Note:** HTTP 404

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/org.py: EvnexOrgSummaryStatus — all 7 per-status connector counts required in both, no optionality anywhere. No known divergence. No fixture existed in either project prior to this sweep for this specific (v2) endpoint — test/support/fixtures.ts's CONNECTOR_SUMMARY_PAYLOAD is the *v3* orgConnectorSummary endpoint's fixture, a structurally different envelope for the same counts.

<details><summary>Redacted response body</summary>

```text
{"errors":[{"status":"404","title":"NotFoundError"}]}
```

</details>

### Endpoints with no findings

### `userDetail` — User detail

- **Method / path template:** `GET /v2/apps/user`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/user.py: EvnexUserDetail — name is `str | None = None` (optional, matches our .nullish()); id/createdDate/updatedDate/email/organisations required in both; type defaults to "User" in both.
- evnex/schema/org.py: EvnexOrgBrief — tierDetails: Any = None (optional in both); namespacePrefix optional in both; all other 7 fields required in both. No known divergence.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "email": "<redacted:email>",
    "createdDate": "2026-03-02T06:20:07.860Z",
    "id": "<redacted:id>",
    "name": "<redacted:name>",
    "organisations": [
      {
        "id": "<redacted:id>",
        "isDefault": true,
        "role": 2,
        "createdDate": "2022-04-13T08:31:03.628Z",
        "name": "<redacted:name>",
        "namespacePrefix": "01DC",
        "slug": "<redacted:orgId>",
        "tier": 1,
        "tierDetails": {},
        "updatedDate": "2022-04-13T08:31:03.628Z"
      }
    ],
    "updatedDate": "2026-08-08T04:58:38.141Z",
    "type": "User"
  }
}
```

</details>
### `chargePointStatus` — Charge point status (command: get-status)

- **Method / path template:** `POST /charge-points/{chargePointId}/commands/get-status`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePointStatus — chargePointStatus optional in both (offline chargers report commandResultStatus without a nested status). ChargePointStatus's 5 fields are all required in both when present. No known divergence.
- A timeout here (EvnexTimeoutError) means the charge point is offline — expected and not itself a schema defect; the examples/getChargePointDetail.ts script deliberately skips this and later calls for an OFFLINE charge point for exactly this reason.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "commandResultStatus": "Accepted",
    "chargePointStatus": {
      "chargeNow": false,
      "chargingLogic": "NoVehicle",
      "chargingCurrentControl": "FullPower",
      "LEDState": "Idle",
      "AntiSleep": "Disabled"
    }
  }
}
```

</details>
### `chargePointEnergyMeterReading` — Charge point energy meter reading (command: get-energy-meter-reading)

- **Method / path template:** `POST /charge-points/{chargePointId}/commands/get-energy-meter-reading`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePointEnergyMeterReading — all 3 fields (timestamp, chargingActivePower, supplyActivePower) required, no optionality anywhere in Python or ours — unlike the v3 connector meter's supplyActivePower, which is optional there. Confirm this capture actually carries all 3 fields; if supplyActivePower is ever absent here that would be a genuine new finding, not merely corroborating the known v3 divergence.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "timestamp": "2026-08-11T02:43:17.441Z",
    "chargingActivePower": 0.016661008819937706,
    "supplyActivePower": 2408.26708984375
  },
  "status": "Accepted"
}
```

</details>
### `chargePointOverride` — Charge point override config (command: get-override)

- **Method / path template:** `POST /charge-points/{chargePointId}/commands/get-override`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePointOverrideConfig.chargeNow — `bool | Literal["NotSupported"]`, required in both, ported as z.union([z.boolean(), z.literal("NotSupported")]). Confirm this capture's value is one of those two shapes and not, e.g., a bare string status like "Enabled"/"Disabled" that would silently fail the union.

<details><summary>Redacted response body</summary>

```json
{
  "chargeNow": false
}
```

</details>
### `chargePointSolarConfig` — Charge point solar config (command: get-solar)

- **Method / path template:** `POST /charge-points/{chargePointId}/commands/get-solar`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/charge_points.py: EvnexChargePointSolarConfig — all 4 fields required in both, no known divergence. No fixture existed in either project prior to this sweep for a charger the sweep operator actually owns; capture is genuinely new evidence either way.

<details><summary>Redacted response body</summary>

```json
{
  "numChargingPhases": "NotSupported",
  "solarWithSchedule": "NotSupported",
  "allowPhaseSwitchingOnSolar": "NotSupported",
  "powerSensorInstalled": true,
  "solarStartExportPower": "NotSupported",
  "solarStopImportPower": "NotSupported",
  "solarControlTargetOffset": "NotSupported",
  "solarControlTargetPower": "NotSupported"
}
```

</details>
### `orgConnectorSummaryV3` — Org connector summary (v3, JSON:API-ish envelope)

- **Method / path template:** `GET /organisations/{orgId}/summary/status`
- **Outcome:** ✅ parsed cleanly
- **HTTP status:** 200

**1. Fields the wire returned that our schema does not declare:**
None observed.

**2. Fields our schema requires that the wire omitted:**
None observed this run. Per PLAN.md: this does not prove any field is mandatory — only that every field happened to be present in this one sample. Absence of evidence for optionality is not evidence of requiredness.

**3. Type and shape mismatches:**
None observed.

**4. Divergence from the Python model:**
- evnex/schema/v3/org.py: EvnexOrgConnectorSummaryAttributes just nests the same EvnexOrgSummaryStatus one level deeper (`attributes.connectors`) — same requiredness as the v2 endpoint above. No known divergence.

<details><summary>Redacted response body</summary>

```json
{
  "data": {
    "attributes": {
      "connectors": {
        "available": 1,
        "charging": 0,
        "disabled": 0,
        "faulted": 0,
        "occupied": 0,
        "offline": 0,
        "reserved": 0
      }
    }
  }
}
```

</details>

---

**Before committing this document (or any redacted capture files alongside it):** review every redacted body above by eye. Automated redaction (`tools/schema-sweep/redact.ts`) is a safety net, not a guarantee — see `docs/downstream-validation.md`.