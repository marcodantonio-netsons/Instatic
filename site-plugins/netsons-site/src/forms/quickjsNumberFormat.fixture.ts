/** Persisted calculations from component shared-virtuelle-private-cloud-b3c7d8, formId vpc-configurator. The same map appears in the imported candidate, integration bundle, and live source snapshot. */
export const vpcCalculationsFixture = {
  "extra": {
    "op": "add",
    "args": [
      {
        "op": "multiply",
        "args": [
          {
            "op": "subtract",
            "args": [
              {
                "field": "cpu"
              },
              {
                "literal": 8
              }
            ]
          },
          {
            "literal": 15
          }
        ]
      },
      {
        "op": "multiply",
        "args": [
          {
            "op": "subtract",
            "args": [
              {
                "field": "ram"
              },
              {
                "literal": 64
              }
            ]
          },
          {
            "literal": 5
          }
        ]
      },
      {
        "op": "multiply",
        "args": [
          {
            "op": "divide",
            "args": [
              {
                "op": "subtract",
                "args": [
                  {
                    "field": "disk"
                  },
                  {
                    "literal": 250
                  }
                ]
              },
              {
                "literal": 10
              }
            ]
          },
          {
            "literal": 2.5
          }
        ]
      },
      {
        "op": "multiply",
        "args": [
          {
            "op": "subtract",
            "args": [
              {
                "field": "ips"
              },
              {
                "literal": 4
              }
            ]
          },
          {
            "literal": 5
          }
        ]
      }
    ]
  },
  "promo": {
    "op": "add",
    "args": [
      {
        "op": "divide",
        "args": [
          {
            "op": "round",
            "args": [
              {
                "op": "multiply",
                "args": [
                  {
                    "op": "add",
                    "args": [
                      {
                        "literal": 499.9
                      },
                      {
                        "field": "extra"
                      }
                    ]
                  },
                  {
                    "literal": 0.8
                  },
                  {
                    "literal": 100
                  }
                ]
              }
            ]
          },
          {
            "literal": 100
          }
        ]
      },
      {
        "field": "gpuMonthly"
      }
    ]
  },
  "minCpu": {
    "op": "lookup",
    "cases": {
      "a30": {
        "op": "multiply",
        "args": [
          {
            "literal": 12
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "a40": {
        "op": "multiply",
        "args": [
          {
            "literal": 16
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "a100": {
        "op": "multiply",
        "args": [
          {
            "literal": 16
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "v100": {
        "op": "multiply",
        "args": [
          {
            "literal": 12
          },
          {
            "field": "gpuCount"
          }
        ]
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "literal": 8
    }
  },
  "minRam": {
    "op": "lookup",
    "cases": {
      "a30": {
        "literal": 64
      },
      "a40": {
        "op": "multiply",
        "args": [
          {
            "literal": 128
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "a100": {
        "op": "multiply",
        "args": [
          {
            "literal": 256
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "v100": {
        "literal": 64
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "literal": 64
    }
  },
  "gpuUnit": {
    "op": "lookup",
    "cases": {
      "a30": {
        "literal": 325
      },
      "a40": {
        "literal": 500
      },
      "a100": {
        "literal": 1899
      },
      "v100": {
        "literal": 200
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "literal": 0
    }
  },
  "minDisk": {
    "op": "lookup",
    "cases": {
      "a30": {
        "op": "multiply",
        "args": [
          {
            "literal": 500
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "a40": {
        "op": "multiply",
        "args": [
          {
            "literal": 1000
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "a100": {
        "op": "multiply",
        "args": [
          {
            "literal": 1000
          },
          {
            "field": "gpuCount"
          }
        ]
      },
      "v100": {
        "op": "multiply",
        "args": [
          {
            "literal": 500
          },
          {
            "field": "gpuCount"
          }
        ]
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "literal": 250
    }
  },
  "renewal": {
    "op": "add",
    "args": [
      {
        "literal": 499.9
      },
      {
        "field": "extra"
      },
      {
        "field": "gpuMonthly"
      }
    ]
  },
  "cpuLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_026ef2aa40cf259bd1a49716}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "cpu"
    }
  },
  "discount": {
    "op": "floor",
    "args": [
      {
        "op": "add",
        "args": [
          {
            "op": "multiply",
            "args": [
              {
                "op": "subtract",
                "args": [
                  {
                    "literal": 1
                  },
                  {
                    "op": "divide",
                    "args": [
                      {
                        "field": "promo"
                      },
                      {
                        "field": "renewal"
                      }
                    ]
                  }
                ]
              },
              {
                "literal": 100
              }
            ]
          },
          {
            "literal": 1e-9
          }
        ]
      }
    ]
  },
  "gpuCount": {
    "op": "min",
    "args": [
      {
        "literal": 10
      },
      {
        "op": "max",
        "args": [
          {
            "literal": 1
          },
          {
            "op": "trunc",
            "args": [
              {
                "field": "gpuQuantity"
              }
            ]
          }
        ]
      }
    ]
  },
  "gpuSpecs": {
    "op": "lookup",
    "cases": {
      "a30": {
        "literal": "{i18n.netsonsFinalData.copy.data_7e2a245066eb7b94f2aef047}"
      },
      "a40": {
        "literal": "{i18n.netsonsFinalData.copy.data_90298d264d87246bf6b7360f}"
      },
      "a100": {
        "literal": "{i18n.netsonsFinalData.copy.data_a93910ed5a1f23b8683304ee}"
      },
      "v100": {
        "literal": "{i18n.netsonsFinalData.copy.data_d4de432c402ae892a5389bff}"
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "literal": ""
    }
  },
  "ipsLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_026ef2aa40cf259bd1a49716}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "ips"
    }
  },
  "ramLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_be57c7e93e6074b007e51d0b}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "ram"
    }
  },
  "diskLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_c2931c2892a0546939b6a79c}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "disk"
    }
  },
  "gpuMonthly": {
    "op": "multiply",
    "args": [
      {
        "field": "gpuUnit"
      },
      {
        "field": "gpuCount"
      }
    ]
  },
  "gpuSummary": {
    "op": "concat",
    "values": [
      {
        "field": "gpuCount"
      },
      {
        "literal": "{i18n.netsonsFinalData.copy.data_7098a68f22042c00a8537ac0}"
      },
      {
        "op": "lookup",
        "cases": {
          "a30": {
            "literal": "{i18n.sharedCopy.nvidia-a30-24-gb_22f9968109}"
          },
          "a40": {
            "literal": "{i18n.sharedCopy.nvidia-a40-48-gb_25be046982}"
          },
          "a100": {
            "literal": "{i18n.sharedCopy.nvidia-a100-80-gb_ca3760cdd9}"
          },
          "v100": {
            "literal": "{i18n.sharedCopy.nvidia-tesla-v100-32_9e5284daf3}"
          }
        },
        "value": {
          "field": "gpuId"
        },
        "otherwise": {
          "literal": ""
        }
      }
    ]
  },
  "promoLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_bdfc2e2f34ddf39c7db8a1b4}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "op": "number-format",
      "value": {
        "field": "promo"
      },
      "locale": "it-IT",
      "maximumFractionDigits": 2,
      "minimumFractionDigits": 2
    }
  },
  "summaryDisk": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_96fb10fbc20628bf69e16f00}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "disk"
    }
  },
  "gpuUnitLabel": {
    "op": "concat",
    "values": [
      {
        "op": "number-format",
        "value": {
          "field": "gpuUnit"
        },
        "locale": "it-IT",
        "maximumFractionDigits": 2,
        "minimumFractionDigits": 2
      },
      {
        "literal": "{i18n.netsonsProductCatalog.shared.rSeriesRenewalSummarySuffix}"
      }
    ]
  },
  "renewalLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_de3cbd73dd46d5f337042fa2}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "op": "number-format",
      "value": {
        "field": "renewal"
      },
      "locale": "it-IT",
      "maximumFractionDigits": 2,
      "minimumFractionDigits": 2
    }
  },
  "discountLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_ae78a00525c5744835d7224a}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "field": "discount"
    }
  },
  "summaryHeading": {
    "op": "replace",
    "value": {
      "op": "replace",
      "value": {
        "literal": "{i18n.netsonsFinalData.copy.data_1a5d911c810c02ce54f1bfa6}"
      },
      "search": {
        "literal": "⟪native_value_0⟫"
      },
      "replacement": {
        "field": "cpu"
      }
    },
    "search": {
      "literal": "⟪native_value_1⟫"
    },
    "replacement": {
      "field": "ram"
    }
  },
  "gpuMonthlyLabel": {
    "op": "concat",
    "values": [
      {
        "op": "number-format",
        "value": {
          "field": "gpuMonthly"
        },
        "locale": "it-IT",
        "maximumFractionDigits": 2,
        "minimumFractionDigits": 2
      },
      {
        "literal": "{i18n.netsonsProductCatalog.shared.rSeriesRenewalSummarySuffix}"
      }
    ]
  },
  "gpuQuantityDisplay": {
    "op": "lookup",
    "cases": {
      "": {
        "literal": 0
      }
    },
    "value": {
      "field": "gpuId"
    },
    "otherwise": {
      "field": "gpuCount"
    }
  },
  "gpuSummaryMonthlyLabel": {
    "op": "replace",
    "value": {
      "literal": "{i18n.netsonsFinalData.copy.data_f8d4a9ddded73d21809ee2bf}"
    },
    "search": {
      "literal": "⟪native_value_0⟫"
    },
    "replacement": {
      "op": "number-format",
      "value": {
        "field": "gpuMonthly"
      },
      "locale": "it-IT",
      "maximumFractionDigits": 2,
      "minimumFractionDigits": 2
    }
  }
} as const
