# CO₂ Pipeline Economic Model

An interactive web-based economic model for CO₂ pipeline infrastructure projects. This tool helps evaluate the financial viability of carbon capture and storage (CCS) pipeline investments.

## 🔗 Live Demo

**[Launch the Model →](https://YOUR_USERNAME.github.io/co2-pipeline-model/)**

## Features

### Engineering Calculations
- **Hydraulic sizing**: Darcy-Weisbach friction calculations with Colebrook-White friction factor
- **Elevation pressure**: Accounts for hydrostatic head (0.347 psi/ft for dense phase CO₂)
- **NPV-optimized diameter selection**: Automatically selects the diameter that maximizes project NPV
- **Pump station requirements**: Calculates booster stations needed based on pressure drop

### Financial Modeling
- **CFA-level financial analysis**: Full income statement, balance sheet items
- **Monthly cash flows**: 360-month (30-year) projections with escalation
- **Breakeven analysis**: Grossed-up equity return methodology
- **Multiple return metrics**: Project IRR, Equity IRR, NPV, DSCR, payback period

### Cost Components
- **Pipeline CAPEX**: Material, labor, ROW, miscellaneous with terrain adjustments
- **Facilities CAPEX**: Pump stations, surge tanks, control systems
- **OPEX**: Maintenance (% of CAPEX) and power consumption
- **Escalation**: Separate rates for general inflation, labor, power, and revenue

### Terrain & Location
- **9 terrain types**: Flat, rolling hills, mountainous, wetland, river crossing, existing ROW, high population, shallow/deep offshore
- **Adjustable cost multipliers**: Customize terrain difficulty factors
- **State-level adjustments**: Regional cost variations

## Usage

### Quick Start
1. Visit the [live demo](https://YOUR_USERNAME.github.io/co2-pipeline-model/)
2. Adjust pipeline parameters (capacity, length, diameter)
3. Set financial assumptions (debt/equity, costs, tax rates)
4. Review results in the Outputs and Charts tabs

### Key Inputs
| Parameter | Default | Description |
|-----------|---------|-------------|
| Design Capacity | 1 Mt/yr | Annual CO₂ throughput |
| Capacity Factor | 90% | Average utilization |
| Length | 100 mi | Pipeline length |
| Diameter | Auto | NPV-optimized selection |
| Elevation Change | 0 ft | Net elevation gain (+ = uphill) |
| CO₂ Price | $85/t | Transport tariff |
| Debt % | 60% | Leverage ratio |
| Cost of Equity | 12% | Required equity return |

### Key Outputs
- **Breakeven Price**: Minimum $/tonne for target equity return
- **Project NPV**: Net present value at WACC
- **Equity IRR**: After-tax internal rate of return
- **Pump Stations**: Number of booster stations required

## Technical Details

### Pressure Drop Calculation
```
Total ΔP = Friction Loss + Elevation Pressure

Friction: Darcy-Weisbach with Colebrook-White f
Elevation: ΔP = ρ × g × Δh = 0.347 psi/ft for 800 kg/m³ CO₂
```

### NPV-Optimized Diameter
The model evaluates all standard pipe diameters and selects the one maximizing project NPV, balancing:
- Lower CAPEX (smaller diameter)
- Lower pressure drop / pump costs (larger diameter)
- Velocity constraints (0.5-3.0 m/s)

### Data Sources
- Pipeline costs: FERC Form 2 filings, industry benchmarks
- Engineering: ASME B31.4, API standards
- CO₂ properties: NIST thermophysical database

## Deployment

### GitHub Pages
1. Fork this repository
2. Go to Settings → Pages
3. Set source to "Deploy from a branch" → main → / (root)
4. Access at `https://YOUR_USERNAME.github.io/co2-pipeline-model/`

### Local Development
```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/co2-pipeline-model.git
cd co2-pipeline-model

# Serve locally (Python 3)
python -m http.server 8000

# Open http://localhost:8000 in your browser
```

## Files

```
co2-pipeline-model/
├── index.html      # Main HTML page
├── app.js          # React application (JSX with Babel)
├── README.md       # This file
└── LICENSE         # MIT License
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Acknowledgments

- Engineering methodology based on industry standards and academic research
- Financial modeling follows CFA Institute best practices
- Inspired by Enverus Intelligence Research pipeline economics models

---

**Disclaimer**: This model is for educational and screening purposes only. All calculations are estimates. Consult qualified engineers and financial advisors for actual project decisions.
