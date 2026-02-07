# Testing Results

Generated on February 7, 2026 from a fresh pipeline run:

```sh
rm -rf test/output/* && node test/test-suite.js
```

## Summary

- Pack Pipeline: 23/23 passed
- Unpack -> Pack: 23/23 passed
- Re-optimise: 23/23 passed
- Re-optimised files are stable (no significant growth)
- High polygon models were simplified correctly
- Low-compression edge cases: 3 models
  - `providence_island_sailing_canal_boat-test`: 0.6%
  - `04 Koz VII`: 0.7%
  - `adrasan copy`: 20.2%

## Full Pack Pipeline Table (23 Models)

| Model | Original | Optimised | Compression | Polygons |
|---|---:|---:|---:|---:|
| `providence_island_sailing_canal_boat-test` | 7.7 MB | 7.6 MB | 0.6% | 186,311 -> 186,311 |
| `providence_island_sailing_canal_boat` | 30.3 MB | 7.7 MB | 74.7% | 186,311 -> 186,311 |
| `blackwall_reach_barge` | 36.2 MB | 14.8 MB | 59.2% | 564,587 -> 564,587 |
| `04 Koz VII` | 39.6 MB | 39.3 MB | 0.7% | 819,403 -> 819,403 |
| `Awhina` | 44.7 MB | 22.1 MB | 50.5% | 999,647 -> 999,647 |
| `enriquillo_shipwreck_aka_uss_stallion_ata-193` | 56.3 MB | 23.4 MB | 58.4% | 987,015 -> 987,015 |
| `dutch_submarine_hnlms_kxi` | 59.9 MB | 17.9 MB | 70.1% | 1,000,000 -> 1,000,000 |
| `model_first_draft_gallipoli_barge_2023` | 60.2 MB | 22.1 MB | 63.3% | 299,999 -> 299,999 |
| `new_hope_shipwreck_bow_section_15445_version_3.0` | 64.0 MB | 26.2 MB | 59.0% | 1,547,406 -> 1,199,996 |
| `stern_of_ss_rifle` | 69.5 MB | 9.4 MB | 86.5% | 249,984 -> 249,984 |
| `trial_1622_wreck_site_2021` | 90.4 MB | 25.9 MB | 71.3% | 2,076,707 -> 1,199,984 |
| `adrasan copy` | 91.9 MB | 73.3 MB | 20.2% | 1,200,000 -> 1,200,000 |
| `01 Junee-blender` | 95.6 MB | 24.9 MB | 74.0% | 1,000,000 -> 1,000,000 |
| `flint_shipwreck` | 98.0 MB | 17.2 MB | 82.4% | 799,999 -> 799,999 |
| `shipwreck_hopkins_2018` | 135.0 MB | 24.2 MB | 82.1% | 3,999,999 -> 1,199,993 |
| `test-junee-quest` | 163.7 MB | 21.4 MB | 86.9% | 10,707,222 -> 1,199,816 |
| `shipwreck_hopkins_yr_2-2019` | 176.5 MB | 26.8 MB | 84.8% | 3,965,486 -> 1,199,988 |
| `shipwreck_jarvenkari_haapasaaret` | 226.8 MB | 29.2 MB | 87.1% | 6,851,343 -> 1,199,971 |
| `shipwreck_stalker_-_3dshipwrecks.org` | 227.6 MB | 27.1 MB | 88.1% | 900,000 -> 900,000 |
| `junee` | 249.2 MB | 17.9 MB | 92.8% | 10,707,222 -> 1,199,822 |
| `carlingford` | 266.3 MB | 21.9 MB | 91.8% | 8,000,000 -> 1,199,948 |
| `dunderberg` | 283.2 MB | 17.9 MB | 93.7% | 7,999,999 -> 823,229 |
| `shipwreck_uunihylky_-_varmbadan_kirkkonummi` | 348.5 MB | 33.0 MB | 90.5% | 9,996,908 -> 821,982 |

## Notes

- README uses a manually curated 12-model subset from the same run.
- Values above come from files generated in `test/output/` and inspected with `src/inspect.js`.
