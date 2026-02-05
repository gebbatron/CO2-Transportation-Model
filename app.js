// CO2 Pipeline Economic Model - Browser Version
// Uses React & Recharts from CDN globals

const { useState, useMemo, useEffect, useRef, useCallback } = React;
const { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart, ReferenceLine, ComposedChart } = Recharts;


// Engineering constants for CO2 pipeline
const ENGINEERING = {
  density: 950, // kg/m³ (supercritical CO2)
  viscosity: 0.00005, // Pa·s
  roughness: 0.0000457, // m (commercial steel)
};

const TARGET_VELOCITY = 2.0; // m/s
const MIN_VELOCITY = 0.5; // m/s - avoid deposition/stagnation
const MAX_VELOCITY = 3.0; // m/s - erosion/noise limit

// Lookup data
const DIAMETERS = [4.5, 6.625, 8.625, 10.75, 12.75, 16, 20, 24, 30, 36, 42, 48];
const GRADES = [
  { name: 'X42', smys: 290 },
  { name: 'X52', smys: 359 },
  { name: 'X60', smys: 414 },
  { name: 'X65', smys: 448 },
  { name: 'X70', smys: 483 },
  { name: 'X80', smys: 552 },
];
const STATES = ['Avg', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY'];
const MODELS = ['Avg', 'Brown', 'McCoy', 'Parker', 'Rui'];

// Default terrain cost multipliers (based on research)
const DEFAULT_TERRAIN_FACTORS = {
  flatDry: 1.0,           // Baseline
  rollingHills: 1.3,      // Moderate terrain
  mountainous: 2.5,       // Difficult terrain, rock
  marshWetland: 1.8,      // Special equipment needed
  river: 2.2,             // HDD or open-cut crossings
  existingROW: 2.2,       // Same as river - parallel ROW constraints
  highPopulation: 1.6,    // More restrictions, slower
  shallowOffshore: 1.5,   // <200m, S-lay method
  deepOffshore: 4.0,      // >200m, J-lay, specialized vessels
};

const STATE_FACTORS = {
  'Avg': 1.0, 'TX': 0.9, 'LA': 0.92, 'OK': 0.93, 'ND': 1.05, 'CA': 1.35, 'NY': 1.25, 'PA': 1.1
};

const calculateRecommendedDiameter = (massFlowRate, capacityFactor) => {
  // Simple fallback - just return velocity-based diameter
  // Real optimization happens in the component with full parameters
  // massFlowRate is the DESIGN capacity - size pipe for this
  const designFlowRate = massFlowRate;
  const flowRateKgS = (designFlowRate * 1e9) / (365.25 * 24 * 3600);
  const volumetricFlow = flowRateKgS / ENGINEERING.density;
  const requiredArea = volumetricFlow / TARGET_VELOCITY;
  const requiredInnerDiameterM = 2 * Math.sqrt(requiredArea / Math.PI);
  const requiredInnerDiameterIn = requiredInnerDiameterM / 0.0254;
  const estimatedOD = requiredInnerDiameterIn * 1.05;
  
  let recommendedDiameter = DIAMETERS[DIAMETERS.length - 1];
  for (const d of DIAMETERS) {
    if (d >= estimatedOD) {
      recommendedDiameter = d;
      break;
    }
  }
  return recommendedDiameter;
};

// Status flag component
const StatusFlag = ({ value, thresholds, unit = '' }) => {
  let color = 'bg-green-500';
  let status = 'OK';
  
  if (thresholds.high !== undefined && value > thresholds.high) {
    color = 'bg-red-500';
    status = 'HIGH';
  } else if (thresholds.low !== undefined && value < thresholds.low) {
    color = 'bg-amber-500';
    status = 'LOW';
  } else if (thresholds.warn !== undefined && value > thresholds.warn) {
    color = 'bg-amber-500';
    status = 'WARN';
  }
  
  return (
    <span className={`${color} text-white text-[9px] px-1.5 py-0.5 rounded font-medium ml-2`}>
      {status}
    </span>
  );
};

// Texas Map Demo Component
const TexasMapDemo = ({ mapPoints, setMapPoints, isDrawing, setIsDrawing, setTerrain, setLength, calculations, formatCurrency }) => {
  const [hoveredZone, setHoveredZone] = useState(null);
  const [showLayers, setShowLayers] = useState({
    terrain: true,
    pipelines: true,
    cities: true,
    offshore: true,
  });
  
  // Texas simplified outline path (SVG coordinates scaled to viewBox)
  const texasPath = "M 180 50 L 280 50 L 320 80 L 350 70 L 380 90 L 400 85 L 420 100 L 450 95 L 480 110 L 500 100 L 530 120 L 540 150 L 530 180 L 540 220 L 520 260 L 530 300 L 510 340 L 520 380 L 500 420 L 480 440 L 450 430 L 420 450 L 380 440 L 350 460 L 300 450 L 280 470 L 250 460 L 220 480 L 180 470 L 150 490 L 120 480 L 100 500 L 80 480 L 60 490 L 40 470 L 50 430 L 40 400 L 60 360 L 50 320 L 70 280 L 60 240 L 80 200 L 70 160 L 90 120 L 100 80 L 130 60 L 160 70 Z";
  
  // Terrain zones with colors and descriptions
  const terrainZones = [
    { id: 'permian', name: 'Permian Basin', path: 'M 100 180 L 180 160 L 200 220 L 180 280 L 120 300 L 80 260 Z', color: '#d4a574', type: 'flatDry', desc: 'Flat desert, oil fields' },
    { id: 'hillcountry', name: 'Hill Country', path: 'M 250 280 L 320 260 L 350 300 L 340 360 L 280 380 L 240 340 Z', color: '#8fbc8f', type: 'rollingHills', desc: 'Rolling limestone hills' },
    { id: 'davis', name: 'Davis Mountains', path: 'M 60 240 L 100 220 L 120 260 L 100 300 L 60 280 Z', color: '#a0522d', type: 'mountainous', desc: 'Mountain terrain' },
    { id: 'gulfcoast', name: 'Gulf Coast', path: 'M 300 400 L 380 380 L 450 420 L 480 450 L 420 480 L 350 470 L 300 450 Z', color: '#87ceeb', type: 'marshWetland', desc: 'Coastal wetlands' },
    { id: 'brazos', name: 'Brazos River', path: 'M 300 200 L 310 200 L 340 300 L 350 380 L 340 380 L 310 300 L 290 200 Z', color: '#4682b4', type: 'river', desc: 'River crossing' },
    { id: 'dfw', name: 'DFW Metro', path: 'M 320 180 L 380 170 L 400 210 L 380 250 L 330 240 L 310 200 Z', color: '#dda0dd', type: 'highPopulation', desc: 'High population density' },
    { id: 'houston', name: 'Houston Metro', path: 'M 400 360 L 450 340 L 480 380 L 460 420 L 410 400 Z', color: '#dda0dd', type: 'highPopulation', desc: 'High population density' },
    { id: 'shallowgulf', name: 'Shallow Gulf', path: 'M 300 480 L 400 470 L 480 490 L 520 520 L 480 550 L 380 560 L 300 540 L 280 510 Z', color: '#add8e6', type: 'shallowOffshore', desc: 'Shallow water <200m' },
    { id: 'deepgulf', name: 'Deep Gulf', path: 'M 320 550 L 460 560 L 520 580 L 540 620 L 480 640 L 380 630 L 300 600 L 290 570 Z', color: '#1e90ff', type: 'deepOffshore', desc: 'Deep water >200m' },
  ];
  
  // Existing pipelines
  const existingPipelines = [
    { id: 'kinder1', name: 'Kinder Morgan EPNG', points: [[100, 250], [200, 240], [300, 260], [400, 300], [450, 350]], color: '#ff6b35' },
    { id: 'enterprise', name: 'Enterprise Products', points: [[150, 300], [250, 320], [350, 340], [420, 380]], color: '#f7931e' },
    { id: 'energy_transfer', name: 'Energy Transfer', points: [[340, 180], [360, 240], [380, 300], [400, 360], [430, 400]], color: '#00a651' },
    { id: 'gulf_south', name: 'Gulf South Pipeline', points: [[450, 380], [480, 420], [500, 480]], color: '#0072bc' },
    { id: 'permian_hw', name: 'Permian Highway', points: [[120, 240], [180, 280], [260, 340], [340, 380], [400, 400]], color: '#662d91' },
  ];
  
  // Cities
  const cities = [
    { name: 'Houston', x: 430, y: 380, size: 'large', pop: '2.3M' },
    { name: 'Dallas', x: 350, y: 190, size: 'large', pop: '1.3M' },
    { name: 'Austin', x: 300, y: 320, size: 'medium', pop: '1.0M' },
    { name: 'San Antonio', x: 270, y: 380, size: 'medium', pop: '1.5M' },
    { name: 'Fort Worth', x: 330, y: 200, size: 'medium', pop: '0.9M' },
    { name: 'El Paso', x: 50, y: 260, size: 'medium', pop: '0.7M' },
    { name: 'Midland', x: 140, y: 240, size: 'small', pop: '0.1M' },
    { name: 'Odessa', x: 120, y: 255, size: 'small', pop: '0.1M' },
    { name: 'Corpus Christi', x: 340, y: 440, size: 'small', pop: '0.3M' },
    { name: 'Beaumont', x: 480, y: 360, size: 'small', pop: '0.1M' },
    { name: 'Galveston', x: 450, y: 430, size: 'small', pop: '0.05M' },
  ];
  
  // CO2 sources and sinks
  const facilities = [
    { name: 'Petra Nova CCS', x: 410, y: 400, type: 'ccs', desc: 'Carbon capture facility' },
    { name: 'Century Plant', x: 130, y: 270, type: 'source', desc: 'Natural gas processing' },
    { name: 'Port Arthur LNG', x: 490, y: 370, type: 'sink', desc: 'Potential storage site' },
    { name: 'Freeport LNG', x: 440, y: 445, type: 'sink', desc: 'Potential storage site' },
  ];

  // Helper to get path bounds - defined before calculateRouteStats which uses it
  const getPathBounds = (pathStr) => {
    const coords = pathStr.match(/[\d.]+/g).map(Number);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i += 2) {
      minX = Math.min(minX, coords[i]);
      maxX = Math.max(maxX, coords[i]);
      minY = Math.min(minY, coords[i+1]);
      maxY = Math.max(maxY, coords[i+1]);
    }
    return { minX, maxX, minY, maxY };
  };

  // Helper function to check if two line segments intersect
  const lineSegmentsIntersect = (p1, p2, p3, p4) => {
    // p1-p2 is first segment, p3-p4 is second segment
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  };

  // Calculate route stats when drawing
  const calculateRouteStats = useCallback(() => {
    if (mapPoints.length < 2) return null;
    
    let totalDistance = 0;
    const terrainCrossed = {};
    let pipelineCrossings = [];
    
    for (let i = 1; i < mapPoints.length; i++) {
      const dx = mapPoints[i].x - mapPoints[i-1].x;
      const dy = mapPoints[i].y - mapPoints[i-1].y;
      const segmentDist = Math.sqrt(dx*dx + dy*dy);
      totalDistance += segmentDist;
      
      // Check which terrain zones this segment crosses (simplified)
      const midX = (mapPoints[i].x + mapPoints[i-1].x) / 2;
      const midY = (mapPoints[i].y + mapPoints[i-1].y) / 2;
      
      for (const zone of terrainZones) {
        // Simple bounding box check for demo
        const pathBounds = getPathBounds(zone.path);
        if (midX >= pathBounds.minX && midX <= pathBounds.maxX && 
            midY >= pathBounds.minY && midY <= pathBounds.maxY) {
          terrainCrossed[zone.type] = (terrainCrossed[zone.type] || 0) + segmentDist;
        }
      }
      
      // Check for pipeline crossings
      const segStart = { x: mapPoints[i-1].x, y: mapPoints[i-1].y };
      const segEnd = { x: mapPoints[i].x, y: mapPoints[i].y };
      
      for (const pipeline of existingPipelines) {
        for (let j = 1; j < pipeline.points.length; j++) {
          const pipeStart = { x: pipeline.points[j-1][0], y: pipeline.points[j-1][1] };
          const pipeEnd = { x: pipeline.points[j][0], y: pipeline.points[j][1] };
          
          if (lineSegmentsIntersect(segStart, segEnd, pipeStart, pipeEnd)) {
            // Check if we haven't already recorded this crossing
            const crossingKey = `${pipeline.id}-${j}`;
            if (!pipelineCrossings.find(c => c.key === crossingKey)) {
              pipelineCrossings.push({
                key: crossingKey,
                pipeline: pipeline.name,
                segmentIndex: i
              });
            }
          }
        }
      }
    }
    
    // Convert pixel distance to miles (rough scale: 500px ≈ 800 miles for Texas)
    const milesPerPixel = 800 / 500;
    const totalMiles = totalDistance * milesPerPixel;
    
    // Calculate terrain percentages
    const terrainPcts = {};
    let assignedDist = 0;
    for (const [type, dist] of Object.entries(terrainCrossed)) {
      terrainPcts[type] = dist / totalDistance;
      assignedDist += dist;
    }
    
    // Assign remaining to flatDry
    if (assignedDist < totalDistance) {
      terrainPcts.flatDry = (terrainPcts.flatDry || 0) + (totalDistance - assignedDist) / totalDistance;
    }
    
    // Calculate ROW crossing percentage
    // Assume each crossing requires ~1000 ft of HDD/bore (about 0.19 miles)
    // This accounts for approach, drilling under, and exit on both sides
    const crossingLengthMiles = 0.19; // ~1000 ft per crossing
    const totalCrossingMiles = pipelineCrossings.length * crossingLengthMiles;
    const rowPct = totalMiles > 0 ? Math.min(totalCrossingMiles / totalMiles, 0.15) : 0; // Cap at 15%
    
    if (rowPct > 0) {
      terrainPcts.existingROW = rowPct;
      // Reduce other terrain proportionally to make room for ROW crossings
      const reduction = 1 - rowPct;
      for (const key of Object.keys(terrainPcts)) {
        if (key !== 'existingROW') {
          terrainPcts[key] *= reduction;
        }
      }
    }
    
    return { 
      totalMiles: Math.round(totalMiles), 
      terrainPcts,
      pipelineCrossings,
      crossingCount: pipelineCrossings.length
    };
  }, [mapPoints]);
  
  const routeStats = calculateRouteStats();
  
  // Apply route to model
  const applyRouteToModel = () => {
    if (!routeStats) return;
    
    setLength(routeStats.totalMiles);
    
    // Build terrain object
    const newTerrain = {
      flatDry: 0, rollingHills: 0, mountainous: 0, marshWetland: 0,
      river: 0, existingROW: 0, highPopulation: 0, shallowOffshore: 0, deepOffshore: 0
    };
    
    for (const [type, pct] of Object.entries(routeStats.terrainPcts)) {
      if (newTerrain.hasOwnProperty(type)) {
        newTerrain[type] = Math.round(pct * 100) / 100;
      }
    }
    
    // Ensure it sums to 1
    const total = Object.values(newTerrain).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const key of Object.keys(newTerrain)) {
        newTerrain[key] = newTerrain[key] / total;
      }
    } else {
      newTerrain.flatDry = 1;
    }
    
    setTerrain(newTerrain);
  };

  return (
    <div className="flex gap-3">
      {/* Map */}
      <div className="flex-1 bg-white border border-gray-200 rounded">
        <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-gray-700 font-semibold text-sm">Texas Pipeline Route Planner</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDrawing(!isDrawing)}
              className={`px-3 py-1 text-xs rounded ${isDrawing ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
            >
              {isDrawing ? '✓ Drawing Mode' : 'Draw Route'}
            </button>
            <button
              onClick={() => setMapPoints([])}
              className="px-3 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            >
              Clear
            </button>
            {routeStats && (
              <button
                onClick={applyRouteToModel}
                className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700"
              >
                Apply to Model
              </button>
            )}
          </div>
        </div>
        
        <svg 
          viewBox="0 0 600 680" 
          className="w-full h-auto cursor-crosshair"
          style={{ maxHeight: '560px' }}
          onClick={(e) => {
            if (!isDrawing) return;
            const svg = e.currentTarget;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
            setMapPoints(prev => [...prev, { x: svgP.x, y: svgP.y }]);
          }}
        >
          {/* Background */}
          <rect x="0" y="0" width="600" height="680" fill="#f0f4f8" />
          
          {/* Gulf of Mexico water */}
          <rect x="0" y="450" width="600" height="230" fill="#b8d4e8" />
          <text x="450" y="620" fontSize="14" fill="#4a7c9b" fontStyle="italic">Gulf of Mexico</text>
          
          {/* Terrain zones */}
          {showLayers.terrain && terrainZones.map(zone => (
            <g key={zone.id}>
              <path
                d={zone.path}
                fill={zone.color}
                fillOpacity={hoveredZone === zone.id ? 0.8 : 0.5}
                stroke={hoveredZone === zone.id ? '#333' : '#666'}
                strokeWidth={hoveredZone === zone.id ? 2 : 1}
                onMouseEnter={() => setHoveredZone(zone.id)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          ))}
          
          {/* Texas outline */}
          <path
            d={texasPath}
            fill="none"
            stroke="#333"
            strokeWidth="2"
          />
          
          {/* Existing pipelines */}
          {showLayers.pipelines && existingPipelines.map(pipeline => (
            <g key={pipeline.id}>
              <polyline
                points={pipeline.points.map(p => p.join(',')).join(' ')}
                fill="none"
                stroke={pipeline.color}
                strokeWidth="3"
                strokeDasharray="8,4"
                opacity="0.7"
              />
            </g>
          ))}
          
          {/* Cities */}
          {showLayers.cities && cities.map(city => (
            <g key={city.name}>
              <circle
                cx={city.x}
                cy={city.y}
                r={city.size === 'large' ? 8 : city.size === 'medium' ? 6 : 4}
                fill={city.size === 'large' ? '#e11d48' : city.size === 'medium' ? '#f97316' : '#6b7280'}
                stroke="white"
                strokeWidth="1.5"
              />
              <text
                x={city.x + 10}
                y={city.y + 4}
                fontSize={city.size === 'large' ? 11 : 9}
                fill="#333"
                fontWeight={city.size === 'large' ? 'bold' : 'normal'}
              >
                {city.name}
              </text>
            </g>
          ))}
          
          {/* Facilities */}
          {facilities.map(fac => (
            <g key={fac.name}>
              <rect
                x={fac.x - 6}
                y={fac.y - 6}
                width="12"
                height="12"
                fill={fac.type === 'ccs' ? '#10b981' : fac.type === 'source' ? '#f59e0b' : '#3b82f6'}
                stroke="white"
                strokeWidth="1.5"
                rx="2"
              />
            </g>
          ))}
          
          {/* User drawn route */}
          {mapPoints.length > 0 && (
            <g>
              {/* Route line */}
              {mapPoints.length > 1 && (
                <polyline
                  points={mapPoints.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              
              {/* Pipeline crossing markers */}
              {routeStats && routeStats.pipelineCrossings && routeStats.pipelineCrossings.map((crossing, idx) => {
                // Find approximate intersection point
                const segIdx = crossing.segmentIndex;
                if (segIdx > 0 && segIdx < mapPoints.length) {
                  const midX = (mapPoints[segIdx].x + mapPoints[segIdx-1].x) / 2;
                  const midY = (mapPoints[segIdx].y + mapPoints[segIdx-1].y) / 2;
                  return (
                    <g key={idx}>
                      {/* Crossing X marker */}
                      <circle cx={midX} cy={midY} r="10" fill="#f59e0b" stroke="white" strokeWidth="2" />
                      <text x={midX} y={midY + 4} fontSize="10" fill="white" textAnchor="middle" fontWeight="bold">⚠</text>
                      {/* HDD indicator */}
                      <text x={midX + 14} y={midY + 3} fontSize="8" fill="#92400e" fontWeight="bold">HDD</text>
                    </g>
                  );
                }
                return null;
              })}
              
              {/* Route points */}
              {mapPoints.map((point, i) => (
                <g key={i}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    fill={i === 0 ? '#16a34a' : i === mapPoints.length - 1 ? '#dc2626' : '#ffffff'}
                    stroke="#16a34a"
                    strokeWidth="2"
                  />
                  <text
                    x={point.x}
                    y={point.y + 4}
                    fontSize="8"
                    fill={i === 0 || i === mapPoints.length - 1 ? 'white' : '#16a34a'}
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    {i === 0 ? 'S' : i === mapPoints.length - 1 ? 'E' : i}
                  </text>
                </g>
              ))}
            </g>
          )}
          
          {/* Scale bar */}
          <g transform="translate(30, 640)">
            <line x1="0" y1="0" x2="100" y2="0" stroke="#333" strokeWidth="2" />
            <line x1="0" y1="-5" x2="0" y2="5" stroke="#333" strokeWidth="2" />
            <line x1="100" y1="-5" x2="100" y2="5" stroke="#333" strokeWidth="2" />
            <text x="50" y="15" fontSize="10" textAnchor="middle" fill="#333">~160 miles</text>
          </g>
          
          {/* North arrow */}
          <g transform="translate(560, 50)">
            <polygon points="0,-20 -8,5 0,0 8,5" fill="#333" />
            <text x="0" y="20" fontSize="12" textAnchor="middle" fill="#333" fontWeight="bold">N</text>
          </g>
        </svg>
      </div>
      
      {/* Legend and controls panel */}
      <div className="w-64 space-y-3">
        {/* Layer toggles */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <h4 className="font-semibold text-gray-700 text-xs uppercase mb-2">Map Layers</h4>
          {Object.entries(showLayers).map(([layer, visible]) => (
            <label key={layer} className="flex items-center gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setShowLayers(prev => ({ ...prev, [layer]: e.target.checked }))}
                className="rounded accent-green-600"
              />
              <span className="text-xs capitalize">{layer}</span>
            </label>
          ))}
        </div>
        
        {/* Terrain legend */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <h4 className="font-semibold text-gray-700 text-xs uppercase mb-2">Terrain Types</h4>
          <div className="space-y-1.5">
            {[
              { color: '#d4a574', label: 'Flat/Dry (1.0x)' },
              { color: '#8fbc8f', label: 'Rolling Hills (1.3x)' },
              { color: '#a0522d', label: 'Mountains (2.5x)' },
              { color: '#87ceeb', label: 'Marsh/Wetland (1.8x)' },
              { color: '#4682b4', label: 'River Crossing (2.2x)' },
              { color: '#f59e0b', label: 'ROW/Pipeline Xing (2.2x)' },
              { color: '#dda0dd', label: 'High Population (1.6x)' },
              { color: '#add8e6', label: 'Shallow Offshore (1.5x)' },
              { color: '#1e90ff', label: 'Deep Offshore (4.0x)' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-4 h-3 rounded" style={{ backgroundColor: item.color, opacity: 0.7 }} />
                <span className="text-xs text-gray-600">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Pipeline legend */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <h4 className="font-semibold text-gray-700 text-xs uppercase mb-2">Existing Pipelines</h4>
          <div className="space-y-1.5">
            {existingPipelines.map(p => (
              <div key={p.id} className="flex items-center gap-2">
                <div className="w-4 h-0.5" style={{ backgroundColor: p.color }} />
                <span className="text-xs text-gray-600">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Facilities legend */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <h4 className="font-semibold text-gray-700 text-xs uppercase mb-2">Facilities</h4>
          <div className="space-y-1.5">
            {[
              { color: '#10b981', label: 'CCS Facility' },
              { color: '#f59e0b', label: 'CO₂ Source' },
              { color: '#3b82f6', label: 'Storage Site' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-xs text-gray-600">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Hovered zone info */}
        {hoveredZone && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <h4 className="font-semibold text-yellow-800 text-xs">
              {terrainZones.find(z => z.id === hoveredZone)?.name}
            </h4>
            <p className="text-xs text-yellow-700 mt-1">
              {terrainZones.find(z => z.id === hoveredZone)?.desc}
            </p>
          </div>
        )}
        
        {/* Route stats */}
        {routeStats && (
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <h4 className="font-semibold text-green-800 text-xs uppercase mb-2">Route Analysis</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-green-700">Est. Length:</span>
                <span className="font-semibold text-green-800">{routeStats.totalMiles} mi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Points:</span>
                <span className="font-semibold text-green-800">{mapPoints.length}</span>
              </div>
              
              {/* Pipeline Crossings */}
              {routeStats.crossingCount > 0 && (
                <div className="border-t border-green-200 pt-1 mt-1">
                  <div className="flex justify-between">
                    <span className="text-green-700 font-medium">Pipeline Crossings:</span>
                    <span className="font-semibold text-amber-600">{routeStats.crossingCount}</span>
                  </div>
                  <div className="pl-2 text-green-600 text-[10px]">
                    {routeStats.pipelineCrossings.map((c, i) => (
                      <div key={i}>• {c.pipeline}</div>
                    ))}
                  </div>
                  <div className="text-[10px] text-green-600 italic mt-1">
                    ~{(routeStats.crossingCount * 0.19).toFixed(2)} mi HDD/bore required
                  </div>
                </div>
              )}
              
              <div className="border-t border-green-200 pt-1 mt-1">
                <span className="text-green-700 font-medium">Terrain Mix:</span>
                {Object.entries(routeStats.terrainPcts).filter(([,v]) => v > 0.01).map(([type, pct]) => (
                  <div key={type} className="flex justify-between pl-2">
                    <span className="text-green-600 capitalize">{type.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="text-green-800">{(pct * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {/* Instructions */}
        <div className="bg-gray-50 border border-gray-200 rounded p-3">
          <h4 className="font-semibold text-gray-700 text-xs uppercase mb-2">Instructions</h4>
          <ol className="text-xs text-gray-600 space-y-1 list-decimal ml-3">
            <li>Click "Draw Route" to enable drawing</li>
            <li>Click on map to add route points</li>
            <li>Route auto-detects terrain types</li>
            <li>Click "Apply to Model" to update inputs</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

function CO2PipelineModel() {
  // Pipeline Parameters
  const [diameter, setDiameter] = useState(8.625);
  const [diameterOverride, setDiameterOverride] = useState(false);
  const [length, setLength] = useState(100);
  const [grade, setGrade] = useState(483);
  const [pressure, setPressure] = useState(2100);
  const [pumpInletPressure, setPumpInletPressure] = useState(1300);
  const [massFlowRate, setMassFlowRate] = useState(1);
  const [capacityFactor, setCapacityFactor] = useState(0.9);
  
  // Advanced pipeline settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [labourWeightSensitivity, setLabourWeightSensitivity] = useState(0.3);
  const [gradePremiumFactor, setGradePremiumFactor] = useState(0);
  
  // Schedule
  const [constructionStart, setConstructionStart] = useState('2024-01-01');
  const [constructionLength, setConstructionLength] = useState(8);
  const [operationalLife, setOperationalLife] = useState(30);
  
  // Costs
  const [costOfCO2, setCostOfCO2] = useState(85);
  const [powerPrice, setPowerPrice] = useState(100);
  
  // Location
  const [state, setState] = useState('TX');
  
  // Terrain percentages
  const [terrain, setTerrain] = useState({
    flatDry: 0.70,
    rollingHills: 0.10,
    mountainous: 0.05,
    marshWetland: 0.03,
    river: 0.05,
    existingROW: 0.02,
    highPopulation: 0.03,
    shallowOffshore: 0.02,
    deepOffshore: 0.00,
  });
  
  // Elevation change (net change from start to end, in feet - positive = uphill)
  const [elevationChange, setElevationChange] = useState(0);
  
  // Terrain cost multipliers (adjustable)
  const [showTerrainAdvanced, setShowTerrainAdvanced] = useState(false);
  const [terrainFactors, setTerrainFactors] = useState({ ...DEFAULT_TERRAIN_FACTORS });
  
  // Financial
  const [economicModel, setEconomicModel] = useState('Avg');
  const [debtPercent, setDebtPercent] = useState(0.6);
  const [debtTerm, setDebtTerm] = useState(20);
  const [costOfDebt, setCostOfDebt] = useState(0.065);
  const [costOfEquity, setCostOfEquity] = useState(0.12);
  const [federalTax, setFederalTax] = useState(0.21);
  const [stateTax, setStateTax] = useState(0.05);
  const [taxableEntity, setTaxableEntity] = useState(true);
  const [depreciationYears, setDepreciationYears] = useState(15);
  
  // Inflation & Escalation
  const [costBaseYear, setCostBaseYear] = useState(2024);
  const [generalInflation, setGeneralInflation] = useState(0.025); // 2.5% general inflation
  const [laborEscalation, setLaborEscalation] = useState(0.03); // 3% labor escalation
  const [powerEscalation, setPowerEscalation] = useState(0.02); // 2% power price escalation
  const [revenueEscalation, setRevenueEscalation] = useState(0.02); // 2% CO2 price escalation
  
  // UI State
  const [activeTab, setActiveTab] = useState('inputs');
  
  // Map state
  const [mapPoints, setMapPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const mapRef = useRef(null);

  // Calculate terrain total
  const terrainTotal = Object.values(terrain).reduce((sum, val) => sum + val, 0);
  const terrainValid = Math.abs(terrainTotal - 1) < 0.001;

  // Update terrain value
  const updateTerrain = (key, value) => {
    setTerrain(prev => ({ ...prev, [key]: value }));
  };

  // Update terrain factor
  const updateTerrainFactor = (key, value) => {
    setTerrainFactors(prev => ({ ...prev, [key]: value }));
  };

  // Reset terrain factors to defaults
  const resetTerrainFactors = () => {
    setTerrainFactors({ ...DEFAULT_TERRAIN_FACTORS });
  };

  // Reset all inputs to Enverus defaults
  const resetToEnverusDefaults = () => {
    // Pipeline Parameters
    setDiameter(8.625);
    setDiameterOverride(false);
    setLength(100);
    setGrade(483); // X70
    setPressure(2100);
    setPumpInletPressure(1300);
    setMassFlowRate(1);
    setCapacityFactor(0.9);
    
    // Advanced
    setShowAdvanced(false);
    setLabourWeightSensitivity(0.3);
    setGradePremiumFactor(0);
    
    // Schedule
    setConstructionStart('2024-01-01');
    setConstructionLength(8);
    setOperationalLife(30);
    
    // Costs
    setCostOfCO2(85);
    setPowerPrice(100);
    
    // Location
    setState('TX');
    
    // Terrain
    setTerrain({
      flatDry: 0.70,
      rollingHills: 0.10,
      mountainous: 0.05,
      marshWetland: 0.03,
      river: 0.05,
      existingROW: 0.02,
      highPopulation: 0.03,
      shallowOffshore: 0.02,
      deepOffshore: 0.00,
    });
    setElevationChange(0);
    setShowTerrainAdvanced(false);
    setTerrainFactors({ ...DEFAULT_TERRAIN_FACTORS });
    
    // Financial
    setEconomicModel('Avg');
    setDebtPercent(0.6);
    setDebtTerm(20);
    setCostOfDebt(0.065);
    setCostOfEquity(0.12);
    setFederalTax(0.21);
    setStateTax(0.05);
    setTaxableEntity(true);
    setDepreciationYears(15);
    
    // Inflation
    setCostBaseYear(2024);
    setGeneralInflation(0.025);
    setLaborEscalation(0.03);
    setPowerEscalation(0.02);
    setRevenueEscalation(0.02);
    
    // Map
    setMapPoints([]);
    setIsDrawing(false);
  };

  // NPV-Optimized Diameter Calculation
  // Calculates full economics for each diameter and picks the one with highest NPV
  // while keeping velocity within acceptable bounds (0.5 - 3.0 m/s)
  const npvOptimizedDiameter = useMemo(() => {
    // massFlowRate is DESIGN capacity, avgFlowRate is actual throughput
    const designFlowRate = massFlowRate;
    const avgFlowRate = massFlowRate * capacityFactor;
    const flowRateKgS = (designFlowRate * 1e9) / (365.25 * 24 * 3600); // Size for design
    const volumetricFlow = flowRateKgS / ENGINEERING.density;
    
    // Common financial parameters
    const combinedTaxRate = taxableEntity ? federalTax + stateTax * (1 - federalTax) : 0;
    const stateFactor = STATE_FACTORS[state] || 1.0;
    const modelFactors = { material: 0.118, labour: 0.283, row: 0.062, misc: 0.145 };
    
    // Calculate weighted terrain factor
    let terrainLocationFactor = 0;
    for (const [key, pct] of Object.entries(terrain)) {
      terrainLocationFactor += pct * (terrainFactors[key] || 1.0);
    }
    
    let bestDiameter = DIAMETERS[0];
    let bestNPV = -Infinity;
    
    for (const d of DIAMETERS) {
      const designFactor = 0.72;
      const wt = (pressure * d) / (2 * grade * 145.037738 * designFactor);
      const innerD = d - 2 * wt;
      const innerDM = innerD * 0.0254;
      
      const flowArea = Math.PI * Math.pow(innerDM / 2, 2);
      const velocity = volumetricFlow / flowArea;
      
      // Skip if velocity is outside acceptable range
      if (velocity > MAX_VELOCITY || velocity < MIN_VELOCITY) continue;
      
      // Pressure drop calculation
      const reynolds = (ENGINEERING.density * velocity * innerDM) / ENGINEERING.viscosity;
      const relativeRoughness = ENGINEERING.roughness / innerDM;
      let frictionFactor = 0.02;
      for (let i = 0; i < 10; i++) {
        const term = relativeRoughness / 3.7 + 2.51 / (reynolds * Math.sqrt(frictionFactor));
        frictionFactor = Math.pow(-2 * Math.log10(term), -2);
      }
      
      const pressureLossPaM = (frictionFactor * ENGINEERING.density * Math.pow(velocity, 2)) / (2 * innerDM);
      const frictionLossPsiMi = (pressureLossPaM * 1609.34) / 6894.76;
      
      // Include elevation pressure
      const elevationPressurePsi = elevationChange * 0.347;
      const elevationPressurePerMile = elevationPressurePsi / length;
      const effectivePressureLossPsiMi = frictionLossPsiMi + elevationPressurePerMile;
      
      const availablePressureDrop = pressure - pumpInletPressure;
      const maxPipeLengthMi = effectivePressureLossPsiMi > 0 ? availablePressureDrop / effectivePressureLossPsiMi : 999;
      const pumpStations = Math.max(1, Math.ceil(length / maxPipeLengthMi));
      
      // Pump power
      const pumpEfficiency = 0.75;
      const pressureRisePa = availablePressureDrop * 6894.76;
      const pumpPowerPerStation = (flowRateKgS * pressureRisePa) / (ENGINEERING.density * pumpEfficiency * 1000);
      const totalPumpPower = pumpPowerPerStation * pumpStations;
      
      // CAPEX
      const diameterFactor = Math.pow(d / 8.625, 1.2);
      const referenceWallThickness = (pressure * d) / (2 * 483 * 145.037738 * 0.72);
      const wallThicknessFactor = wt / referenceWallThickness;
      const labourWeightFactor = (1 - labourWeightSensitivity) + labourWeightSensitivity * wallThicknessFactor;
      
      const material = modelFactors.material * length * diameterFactor * stateFactor;
      const labour = modelFactors.labour * length * diameterFactor * stateFactor * terrainLocationFactor * labourWeightFactor;
      const row = modelFactors.row * length * stateFactor;
      const misc = modelFactors.misc * length * diameterFactor * stateFactor;
      const pipelineCAPEX = material + labour + row + misc;
      
      const pumpFixedCost = 0.136 * pumpStations;
      const pumpVariableCost = 0.00215 * totalPumpPower;
      const facilitiesCAPEX = pumpFixedCost + pumpVariableCost + 1.77 + 0.19;
      
      const installedCost = pipelineCAPEX + facilitiesCAPEX;
      const financingCost = installedCost * costOfDebt * (constructionLength / 12) * 0.5;
      const totalCAPEX = installedCost + financingCost;
      
      // OPEX
      const pipelineOPEX = pipelineCAPEX * 0.025;
      const facilityOPEX = facilitiesCAPEX * 0.04;
      const powerCost = (totalPumpPower * 8760 * capacityFactor / 1000 * powerPrice) / 1e6;
      const totalOPEX = pipelineOPEX + facilityOPEX + powerCost;
      
      // NPV calculation - revenue based on AVERAGE flow, not design
      const annualRevenue = avgFlowRate * 1e6 * costOfCO2 / 1e6;
      const annualDepreciation = totalCAPEX / depreciationYears;
      const annualEBITDA = annualRevenue - totalOPEX;
      const annualEBIT = annualEBITDA - annualDepreciation;
      const unleveredFCF = annualEBIT * (1 - combinedTaxRate) + annualDepreciation;
      
      const afterTaxCostOfDebt = costOfDebt * (1 - combinedTaxRate);
      const wacc = (debtPercent * afterTaxCostOfDebt) + ((1 - debtPercent) * costOfEquity);
      
      let projectNPV = -totalCAPEX;
      for (let yr = 1; yr <= operationalLife; yr++) {
        projectNPV += unleveredFCF / Math.pow(1 + wacc, yr);
      }
      
      if (projectNPV > bestNPV) {
        bestNPV = projectNPV;
        bestDiameter = d;
      }
    }
    
    return bestDiameter;
  }, [massFlowRate, capacityFactor, length, pressure, pumpInletPressure, grade, 
      state, terrain, terrainFactors, costOfDebt, costOfEquity, debtPercent,
      federalTax, stateTax, taxableEntity, depreciationYears, operationalLife,
      constructionLength, costOfCO2, powerPrice, labourWeightSensitivity, elevationChange]);

  // Legacy velocity-based recommendation (for reference/comparison)
  const velocityBasedDiameter = useMemo(() => {
    return calculateRecommendedDiameter(massFlowRate, capacityFactor);
  }, [massFlowRate, capacityFactor]);

  // Auto-update diameter to NPV-optimized value
  useEffect(() => {
    if (!diameterOverride) {
      setDiameter(npvOptimizedDiameter);
    }
  }, [npvOptimizedDiameter, diameterOverride]);

  // Main calculations
  const calculations = useMemo(() => {
    // massFlowRate is now the DESIGN capacity, avgFlowRate is actual throughput
    const designFlowRate = massFlowRate; // User input is design capacity
    const avgFlowRate = massFlowRate * capacityFactor; // Actual average throughput
    const flowRateKgS = (designFlowRate * 1e9) / (365.25 * 24 * 3600); // Size pipe for design
    
    const designFactor = 0.72;
    const wallThickness = (pressure * diameter) / (2 * grade * 145.037738 * designFactor);
    const innerDiameter = diameter - 2 * wallThickness;
    const innerDiameterM = innerDiameter * 0.0254;
    
    const flowArea = Math.PI * Math.pow(innerDiameterM / 2, 2);
    const volumetricFlow = flowRateKgS / ENGINEERING.density;
    const velocity = volumetricFlow / flowArea;
    
    const reynolds = (ENGINEERING.density * velocity * innerDiameterM) / ENGINEERING.viscosity;
    const relativeRoughness = ENGINEERING.roughness / innerDiameterM;
    let frictionFactor = 0.02;
    for (let i = 0; i < 10; i++) {
      const term = relativeRoughness / 3.7 + 2.51 / (reynolds * Math.sqrt(frictionFactor));
      frictionFactor = Math.pow(-2 * Math.log10(term), -2);
    }
    
    // Pressure loss in Pa/m (Darcy-Weisbach) - FRICTION component
    const pressureLossPaM = (frictionFactor * ENGINEERING.density * Math.pow(velocity, 2)) / (2 * innerDiameterM);
    
    // Convert to psi/mile for easier understanding
    // 1 psi = 6894.76 Pa, 1 mile = 1609.34 m
    const frictionLossPsiMi = (pressureLossPaM * 1609.34) / 6894.76;
    
    // ELEVATION component: ΔP = ρ × g × Δh
    // For dense phase CO₂ at 800 kg/m³: ~0.347 psi per foot of elevation gain
    // Positive elevation change = need more pressure (pumping uphill)
    const elevationPressurePsi = elevationChange * 0.347; // psi for total elevation change
    
    // Total friction loss over entire pipeline
    const totalFrictionLossPsi = frictionLossPsiMi * length;
    
    // Total pressure drop = friction + elevation
    const totalPressureLossPsi = totalFrictionLossPsi + elevationPressurePsi;
    
    // Available pressure drop per segment (psi) - without elevation
    const availablePressurePerSegment = pressure - pumpInletPressure;
    
    // For pump station calculation, we need to account for both friction AND elevation
    // Total pressure budget = (# stations) × (available pressure per station)
    // Must overcome: friction losses + elevation change
    // Solve: N × availablePressure >= totalFrictionLoss + elevationPressure
    // But elevation is a one-time cost distributed across the route
    
    // Effective pressure available after accounting for elevation (distributed per mile)
    const elevationPressurePerMile = elevationPressurePsi / length;
    const effectivePressureLossPsiMi = frictionLossPsiMi + elevationPressurePerMile;
    
    // Max segment length (miles) before needing a pump station
    const maxPipeLengthMi = effectivePressureLossPsiMi > 0 ? availablePressurePerSegment / effectivePressureLossPsiMi : 999;
    
    // Number of pump stations needed (minimum 1 for initial compression)
    const numSegments = Math.ceil(length / maxPipeLengthMi);
    const pumpStations = Math.max(1, numSegments);
    
    // Pump power calculation
    // Power = (mass flow rate × pressure rise) / (density × efficiency)
    const pumpEfficiency = 0.75;
    const pressureRisePa = availablePressurePerSegment * 6894.76; // Convert psi to Pa
    
    // Power per pump station (kW)
    const pumpPowerPerStation = (flowRateKgS * pressureRisePa) / (ENGINEERING.density * pumpEfficiency * 1000);
    
    // Total pump power for all stations
    const totalPumpPower = pumpPowerPerStation * pumpStations;
    
    const velocityStatus = velocity > MAX_VELOCITY ? 'high' : velocity < 0.5 ? 'low' : 'ok';
    
    // Inflation escalation factors
    // Calculate years from base year to construction midpoint
    const constructionStartYear = new Date(constructionStart).getFullYear();
    const constructionMidpointYear = constructionStartYear + (constructionLength / 12) / 2;
    const yearsToConstruction = Math.max(0, constructionMidpointYear - costBaseYear);
    
    // CAPEX escalation factors (from base year to construction midpoint)
    const generalEscalationFactor = Math.pow(1 + generalInflation, yearsToConstruction);
    const laborEscalationFactor = Math.pow(1 + laborEscalation, yearsToConstruction);
    
    // CAPEX with terrain factors
    const stateFactor = STATE_FACTORS[state] || 1.0;
    const modelFactors = {
      'Avg': { material: 0.118, labour: 0.283, row: 0.062, misc: 0.145 },
      'Brown': { material: 0.105, labour: 0.265, row: 0.055, misc: 0.135 },
      'McCoy': { material: 0.125, labour: 0.295, row: 0.068, misc: 0.155 },
      'Parker': { material: 0.112, labour: 0.275, row: 0.058, misc: 0.140 },
      'Rui': { material: 0.130, labour: 0.305, row: 0.072, misc: 0.160 },
    };
    
    const factors = modelFactors[economicModel];
    const diameterFactor = Math.pow(diameter / 8.625, 1.2);
    
    const gradeBaseline = 483;
    const materialGradeFactor = 1 + (grade - gradeBaseline) / gradeBaseline * gradePremiumFactor;
    
    // Calculate weighted terrain factor
    let terrainLocationFactor = 0;
    for (const [key, pct] of Object.entries(terrain)) {
      terrainLocationFactor += pct * (terrainFactors[key] || 1.0);
    }
    
    // Base costs (in base year dollars)
    const materialBase = factors.material * length * diameterFactor * stateFactor * materialGradeFactor;
    const referenceWallThickness = (pressure * diameter) / (2 * 483 * 145.037738 * 0.72);
    const wallThicknessFactor = wallThickness / referenceWallThickness;
    const labourWeightFactor = (1 - labourWeightSensitivity) + labourWeightSensitivity * wallThicknessFactor;
    const labourBase = factors.labour * length * diameterFactor * stateFactor * terrainLocationFactor * labourWeightFactor;
    const rowBase = factors.row * length * stateFactor;
    const miscBase = factors.misc * length * diameterFactor * stateFactor;
    
    // Escalated costs (in nominal dollars at construction)
    const material = materialBase * generalEscalationFactor;
    const labour = labourBase * laborEscalationFactor;
    const row = rowBase * generalEscalationFactor;
    const misc = miscBase * generalEscalationFactor;
    const pipelineCAPEX = material + labour + row + misc;
    
    // Pump CAPEX: fixed cost per station + variable cost based on total installed power
    const pumpFixedCost = 0.136 * pumpStations;
    const pumpVariableCost = 0.00215 * totalPumpPower; // Use total power for all stations
    const pumpCAPEX = pumpFixedCost + pumpVariableCost;
    const surgeTankCAPEX = 1.77;
    const controlSystemCAPEX = 0.19;
    const facilitiesCAPEX = pumpCAPEX + surgeTankCAPEX + controlSystemCAPEX;
    
    const installedCost = pipelineCAPEX + facilitiesCAPEX;
    const financingCost = installedCost * costOfDebt * (constructionLength / 12) * 0.5;
    const totalCAPEX = installedCost + financingCost;
    
    // Base OPEX (Year 1, in nominal dollars at in-service date)
    const pipelineOPEX = pipelineCAPEX * 0.025;
    const facilityOPEX = facilitiesCAPEX * 0.04;
    // Power consumption based on total pump power running at capacity factor
    const powerConsumption = totalPumpPower * 8760 * capacityFactor; // kWh/year
    const powerConsumptionMWh = powerConsumption / 1000;
    const powerCost = (powerConsumptionMWh * powerPrice) / 1e6; // Convert to $MM (Year 1)
    const totalOPEX = pipelineOPEX + facilityOPEX + powerCost; // Year 1 OPEX
    
    // Base Revenue (Year 1)
    const annualRevenueBase = avgFlowRate * 1e6 * costOfCO2 / 1e6;
    
    // Financial calculations
    const debtSize = totalCAPEX * debtPercent;
    const equitySize = totalCAPEX * (1 - debtPercent);
    const combinedTaxRate = taxableEntity ? federalTax + stateTax * (1 - federalTax) : 0;
    const afterTaxCostOfDebt = costOfDebt * (1 - combinedTaxRate);
    const wacc = (debtPercent * afterTaxCostOfDebt) + ((1 - debtPercent) * costOfEquity);
    
    const annualDebtService = debtSize * (costOfDebt * Math.pow(1 + costOfDebt, debtTerm)) / (Math.pow(1 + costOfDebt, debtTerm) - 1);
    const avgDebtBalance = debtSize * (debtTerm + 1) / (2 * debtTerm);
    const annualInterest = avgDebtBalance * costOfDebt;
    const annualPrincipal = annualDebtService - annualInterest;
    const annualDepreciation = totalCAPEX / depreciationYears;
    
    // Year-by-year cash flows with escalation
    const equityCashFlows = [-equitySize];
    const projectCashFlows = [-totalCAPEX];
    let totalRevenue = 0, totalOPEXLife = 0, totalPowerCostLife = 0;
    
    for (let yr = 1; yr <= operationalLife; yr++) {
      // Escalate revenue and OPEX each year
      const revenueEsc = annualRevenueBase * Math.pow(1 + revenueEscalation, yr - 1);
      const opexMaintenanceEsc = (pipelineOPEX + facilityOPEX) * Math.pow(1 + generalInflation, yr - 1);
      const powerCostEsc = powerCost * Math.pow(1 + powerEscalation, yr - 1);
      const opexEsc = opexMaintenanceEsc + powerCostEsc;
      
      totalRevenue += revenueEsc;
      totalOPEXLife += opexEsc;
      totalPowerCostLife += powerCostEsc;
      
      // Depreciation (not escalated - based on original cost)
      const depreciation = yr <= depreciationYears ? annualDepreciation : 0;
      
      // Debt service (not escalated - fixed payments)
      const debtSvc = yr <= debtTerm ? annualDebtService : 0;
      const interest = yr <= debtTerm ? annualInterest * (debtTerm - yr + 1) / debtTerm : 0; // Declining interest
      const principal = debtSvc - interest;
      
      // P&L
      const ebitda = revenueEsc - opexEsc;
      const ebit = ebitda - depreciation;
      const ebt = ebit - interest;
      const tax = taxableEntity ? Math.max(0, ebt * combinedTaxRate) : 0;
      const netInc = ebt - tax;
      const fcfeYr = netInc + depreciation - principal;
      const unleveredFCFYr = ebit * (1 - combinedTaxRate) + depreciation;
      
      equityCashFlows.push(fcfeYr);
      projectCashFlows.push(unleveredFCFYr);
    }
    
    // Use Year 1 values for display (base year metrics)
    const annualRevenue = annualRevenueBase;
    const annualEBITDA = annualRevenue - totalOPEX;
    const annualEBIT = annualEBITDA - annualDepreciation;
    const annualEBT = annualEBIT - annualInterest;
    const taxExpense = taxableEntity ? Math.max(0, annualEBT * combinedTaxRate) : 0;
    const netIncome = annualEBT - taxExpense;
    const fcfe = netIncome + annualDepreciation - annualPrincipal;
    const unleveredFCF = annualEBIT * (1 - combinedTaxRate) + annualDepreciation;
    
    const requiredEquityReturn = equitySize * costOfEquity;
    
    // Breakeven calculation (Year 1 basis)
    // At breakeven price, Revenue = Costs, so Profit = 0, so Taxes = 0
    // Breakeven is the price needed to cover: OPEX + Debt Service + Required Equity Return
    // But equity return is after-tax, so we need to gross it up
    const levelizedCapex = totalCAPEX / operationalLife;
    const financingCostAnnual = Math.max(0, annualDebtService - levelizedCapex * debtPercent);
    
    // Before-tax breakeven (covers operating costs + capital recovery)
    const btaxBreakeven = (levelizedCapex + totalOPEX + financingCostAnnual) / avgFlowRate;
    
    // After-tax breakeven: to deliver required equity return after taxes,
    // you need to earn more pre-tax. Gross up the equity return portion.
    // At breakeven: Revenue - OPEX - Depreciation - Interest = EBT
    // Tax = EBT * taxRate, Net Income = EBT * (1 - taxRate)
    // We need Net Income >= required equity return
    // So EBT >= requiredEquityReturn / (1 - taxRate)
    const grossedUpEquityReturn = taxableEntity ? requiredEquityReturn / (1 - combinedTaxRate) : requiredEquityReturn;
    const ataxBreakeven = (totalOPEX + annualDebtService + grossedUpEquityReturn) / avgFlowRate;
    
    const calculateIRR = (cashFlows) => {
      let irr = 0.1;
      for (let iter = 0; iter < 100; iter++) {
        let npv = 0, dnpv = 0;
        for (let i = 0; i < cashFlows.length; i++) {
          npv += cashFlows[i] / Math.pow(1 + irr, i);
          dnpv -= i * cashFlows[i] / Math.pow(1 + irr, i + 1);
        }
        if (Math.abs(npv) < 0.0001) break;
        irr = irr - npv / dnpv;
        if (irr < -0.99) irr = -0.99;
        if (irr > 10) irr = 10;
      }
      return irr;
    };
    
    const equityIRR = calculateIRR(equityCashFlows);
    const projectIRR = calculateIRR(projectCashFlows);
    
    const equityNPV = equityCashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + costOfEquity, i), 0);
    const projectNPV = projectCashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + wacc, i), 0);
    
    let cumulativeCF = -equitySize, paybackMonths = operationalLife * 12;
    for (let i = 1; i <= operationalLife; i++) {
      cumulativeCF += fcfe;
      if (cumulativeCF >= 0) {
        const fraction = (equitySize - (i - 1) * fcfe) / fcfe;
        paybackMonths = Math.round((i - 1 + fraction) * 12);
        break;
      }
    }
    
    let discountedCF = -equitySize, discountedPaybackMonths = operationalLife * 12;
    for (let i = 1; i <= operationalLife; i++) {
      discountedCF += fcfe / Math.pow(1 + costOfEquity, i);
      if (discountedCF >= 0) {
        discountedPaybackMonths = i * 12;
        break;
      }
    }
    
    const roic = annualEBIT * (1 - combinedTaxRate) / totalCAPEX;
    const dscr = annualEBITDA / annualDebtService;
    const interestCoverage = annualEBIT / annualInterest;
    const netDebtEBITDA = debtSize / annualEBITDA;
    
    const startDate = new Date(constructionStart);
    const inServiceDate = new Date(startDate);
    inServiceDate.setMonth(inServiceDate.getMonth() + constructionLength);
    
    return {
      wallThickness, innerDiameter, designFlowRate, avgFlowRate, velocity, velocityStatus, 
      frictionLoss: frictionLossPsiMi, // psi/mile friction only
      elevationPressure: elevationPressurePsi, // total psi for elevation
      totalPressureLoss: totalPressureLossPsi, // total pressure drop (friction + elevation)
      maxPipeLengthMi, pumpStations, 
      pumpPowerPerStation, totalPumpPower, // Both per-station and total
      material, labour, row, misc, pipelineCAPEX,
      pumpCAPEX, facilitiesCAPEX, installedCost, financingCost, totalCAPEX, pipelineOPEX,
      facilityOPEX, powerCost, totalOPEX, debtSize, equitySize, annualDebtService,
      annualInterest, annualDepreciation, annualRevenue, annualEBITDA, annualEBIT, annualEBT,
      taxExpense, netIncome, fcfe, unleveredFCF, wacc, equityIRR, projectIRR, equityNPV,
      projectNPV, paybackMonths, discountedPaybackMonths, btaxBreakeven, ataxBreakeven,
      roic, dscr, interestCoverage, netDebtEBITDA, combinedTaxRate, terrainLocationFactor,
      generalEscalationFactor, laborEscalationFactor, yearsToConstruction,
      inServiceDate: inServiceDate.toLocaleDateString()
    };
  }, [diameter, length, grade, pressure, pumpInletPressure, massFlowRate, capacityFactor,
      state, terrain, terrainFactors, economicModel, debtPercent, debtTerm, costOfDebt, costOfEquity,
      federalTax, stateTax, taxableEntity, depreciationYears, costOfCO2, powerPrice,
      constructionStart, constructionLength, operationalLife, labourWeightSensitivity, gradePremiumFactor, elevationChange,
      costBaseYear, generalInflation, laborEscalation, powerEscalation, revenueEscalation]);

  // Chart data
  const capexData = [
    { name: 'Material', value: calculations.material, color: '#6b8e23' },
    { name: 'Labour', value: calculations.labour, color: '#8fbc8f' },
    { name: 'ROW', value: calculations.row, color: '#556b2f' },
    { name: 'Misc', value: calculations.misc, color: '#9acd32' },
    { name: 'Facilities', value: calculations.facilitiesCAPEX, color: '#808080' },
  ];

  const opexData = [
    { name: 'Pipeline Maint.', value: calculations.pipelineOPEX },
    { name: 'Facility Maint.', value: calculations.facilityOPEX },
    { name: 'Power', value: calculations.powerCost },
  ];

  const cashFlowData = [];
  let cumulative = -calculations.equitySize;
  cashFlowData.push({ year: 0, annual: -calculations.equitySize, cumulative });
  for (let i = 1; i <= Math.min(operationalLife, 30); i++) {
    cumulative += calculations.fcfe;
    cashFlowData.push({ year: i, annual: calculations.fcfe, cumulative });
  }

  // Cost per tonne breakdown - matches breakeven, shows where money goes
  const avgFlowRate = massFlowRate * capacityFactor;
  
  // 1. Operating costs
  const opexPerTonne = calculations.totalOPEX / avgFlowRate;
  
  // 2. Capital recovery (paying back principal to debt + equity)
  const annualPrincipal = calculations.annualDebtService - calculations.annualInterest;
  const capexRecoveryPerTonne = (annualPrincipal + calculations.equitySize / operationalLife) / avgFlowRate;
  
  // 3. Cost of debt (interest to lenders)
  const interestPerTonne = calculations.annualInterest / avgFlowRate;
  
  // 4. Cost of equity (return to equity investors, pre-tax)
  const requiredEquityReturn = calculations.equitySize * costOfEquity;
  const equityReturnPerTonne = requiredEquityReturn / avgFlowRate;
  
  // 5. Tax gross-up (extra needed so equity gets their return after-tax)
  const grossedUpEquityReturn = taxableEntity 
    ? requiredEquityReturn / (1 - calculations.combinedTaxRate)
    : requiredEquityReturn;
  const taxGrossUpPerTonne = (grossedUpEquityReturn - requiredEquityReturn) / avgFlowRate;
  
  const costPerTonneData = [
    { name: 'OPEX', value: opexPerTonne, color: '#6b8e23' },
    { name: 'Capital Recovery', value: capexRecoveryPerTonne, color: '#8fbc8f' },
    { name: 'Interest', value: interestPerTonne, color: '#556b2f' },
    { name: 'Equity Return', value: equityReturnPerTonne, color: '#9acd32' },
    { name: 'Tax Gross-up', value: taxGrossUpPerTonne, color: '#bdb76b' },
  ];

  const sensitivityData = useMemo(() => {
    const baseNPV = calculations.projectNPV;
    const pct = 0.25; // ±25%
    const pvFactor = (1 - Math.pow(1 + calculations.wacc, -operationalLife)) / calculations.wacc;
    
    const vars = [
      { name: 'CO₂ Price', factor: 'revenue' },
      { name: 'CAPEX', factor: 'capex' },
      { name: 'Flow Rate', factor: 'flow' },
      { name: 'OPEX', factor: 'opex' },
      { name: 'Cost of Equity', factor: 'coe' },
      { name: 'Debt %', factor: 'leverage' },
      { name: 'Pipeline Length', factor: 'length' },
      { name: 'Power Price', factor: 'power' },
    ];
    
    const results = vars.map(v => {
      let lowNPV, highNPV;
      
      if (v.factor === 'revenue') {
        const deltaRev = calculations.annualRevenue * pct * (1 - calculations.combinedTaxRate);
        lowNPV = baseNPV - deltaRev * pvFactor;
        highNPV = baseNPV + deltaRev * pvFactor;
      } else if (v.factor === 'capex') {
        const deltaCAPEX = calculations.totalCAPEX * pct;
        highNPV = baseNPV - deltaCAPEX; // Higher CAPEX = lower NPV
        lowNPV = baseNPV + deltaCAPEX;  // Lower CAPEX = higher NPV
      } else if (v.factor === 'flow') {
        // Flow affects both revenue and some OPEX (power)
        const deltaRev = calculations.annualRevenue * pct * (1 - calculations.combinedTaxRate);
        lowNPV = baseNPV - deltaRev * pvFactor;
        highNPV = baseNPV + deltaRev * pvFactor;
      } else if (v.factor === 'opex') {
        const deltaOPEX = calculations.totalOPEX * pct * (1 - calculations.combinedTaxRate);
        highNPV = baseNPV - deltaOPEX * pvFactor; // Higher OPEX = lower NPV
        lowNPV = baseNPV + deltaOPEX * pvFactor;
      } else if (v.factor === 'coe') {
        // Higher cost of equity increases WACC, reduces NPV
        const baseWACC = calculations.wacc;
        const deltaCoE = costOfEquity * pct;
        const highWACC = (debtPercent * costOfDebt * (1 - calculations.combinedTaxRate)) + ((1 - debtPercent) * (costOfEquity + deltaCoE));
        const lowWACC = (debtPercent * costOfDebt * (1 - calculations.combinedTaxRate)) + ((1 - debtPercent) * (costOfEquity - deltaCoE));
        const highPVFactor = (1 - Math.pow(1 + highWACC, -operationalLife)) / highWACC;
        const lowPVFactor = (1 - Math.pow(1 + lowWACC, -operationalLife)) / lowWACC;
        highNPV = -calculations.totalCAPEX + calculations.unleveredFCF * lowPVFactor; // Lower CoE = higher NPV
        lowNPV = -calculations.totalCAPEX + calculations.unleveredFCF * highPVFactor;
      } else if (v.factor === 'leverage') {
        // More debt typically increases NPV if project IRR > cost of debt (tax shield benefit)
        const deltaDebt = debtPercent * pct;
        const taxShieldBenefit = calculations.totalCAPEX * deltaDebt * costOfDebt * calculations.combinedTaxRate * pvFactor;
        highNPV = baseNPV + taxShieldBenefit * 0.5; // Simplified
        lowNPV = baseNPV - taxShieldBenefit * 0.5;
      } else if (v.factor === 'length') {
        // Longer pipeline = more CAPEX and OPEX
        const deltaCAPEX = calculations.pipelineCAPEX * pct;
        const deltaOPEX = calculations.pipelineOPEX * pct * (1 - calculations.combinedTaxRate);
        highNPV = baseNPV - deltaCAPEX - deltaOPEX * pvFactor; // Longer = lower NPV
        lowNPV = baseNPV + deltaCAPEX + deltaOPEX * pvFactor;
      } else if (v.factor === 'power') {
        const deltaPower = calculations.powerCost * pct * (1 - calculations.combinedTaxRate);
        highNPV = baseNPV - deltaPower * pvFactor; // Higher power cost = lower NPV
        lowNPV = baseNPV + deltaPower * pvFactor;
      }
      
      const lowDelta = lowNPV - baseNPV;
      const highDelta = highNPV - baseNPV;
      const range = Math.abs(highDelta - lowDelta);
      
      return { name: v.name, low: lowDelta, high: highDelta, range };
    });
    
    // Sort by range (largest impact first) for tornado chart
    return results.sort((a, b) => b.range - a.range);
  }, [calculations, operationalLife, costOfEquity, costOfDebt, debtPercent]);

  const breakevenByDistanceData = useMemo(() => {
    const data = [];
    const avgFlowRate = massFlowRate * capacityFactor;
    for (let dist = 25; dist <= 300; dist += 25) {
      const distRatio = dist / length;
      const scaledCAPEX = calculations.totalCAPEX * distRatio;
      const scaledPipelineOPEX = calculations.pipelineOPEX * distRatio;
      const scaledOPEX = scaledPipelineOPEX + calculations.facilityOPEX + calculations.powerCost;
      const scaledDebt = scaledCAPEX * debtPercent;
      const scaledEquity = scaledCAPEX * (1 - debtPercent);
      const scaledDebtService = scaledDebt * (costOfDebt * Math.pow(1 + costOfDebt, debtTerm)) / (Math.pow(1 + costOfDebt, debtTerm) - 1);
      
      // Breakeven: OPEX + Debt Service + Grossed-up Equity Return
      const requiredEquityReturn = scaledEquity * costOfEquity;
      const grossedUpEquityReturn = taxableEntity ? requiredEquityReturn / (1 - calculations.combinedTaxRate) : requiredEquityReturn;
      
      const breakeven = (scaledOPEX + scaledDebtService + grossedUpEquityReturn) / avgFlowRate;
      data.push({ distance: dist, breakeven });
    }
    return data;
  }, [calculations, length, debtPercent, costOfDebt, costOfEquity, debtTerm, massFlowRate, capacityFactor, taxableEntity]);

  const leverageData = useMemo(() => {
    const data = [];
    const projectIRRBase = calculations.projectIRR;
    
    for (let debt = 0; debt <= 80; debt += 10) {
      const debtRatio = debt / 100;
      const equityRatio = 1 - debtRatio;
      const debtAmt = calculations.totalCAPEX * debtRatio;
      const equityAmt = calculations.totalCAPEX * equityRatio;
      
      if (equityAmt < 0.01) continue;
      
      const ds = debtAmt > 0 ? debtAmt * (costOfDebt * Math.pow(1 + costOfDebt, debtTerm)) / (Math.pow(1 + costOfDebt, debtTerm) - 1) : 0;
      const avgInt = debtAmt * costOfDebt * (debtTerm + 1) / (2 * debtTerm);
      const principal = ds - avgInt;
      const ebt = calculations.annualEBIT - avgInt;
      const tax = Math.max(0, ebt * calculations.combinedTaxRate);
      const netInc = ebt - tax;
      const fcfeCalc = netInc + calculations.annualDepreciation - principal;
      
      const cfs = [-equityAmt];
      for (let i = 0; i < operationalLife; i++) cfs.push(fcfeCalc);
      
      let irr = 0.1;
      for (let iter = 0; iter < 50; iter++) {
        let npv = 0, dnpv = 0;
        for (let i = 0; i < cfs.length; i++) {
          npv += cfs[i] / Math.pow(1 + irr, i);
          dnpv -= i * cfs[i] / Math.pow(1 + irr, i + 1);
        }
        if (Math.abs(npv) < 0.0001 || Math.abs(dnpv) < 0.0001) break;
        irr = irr - npv / dnpv;
        if (irr < -0.5) irr = -0.5;
        if (irr > 2) irr = 2;
      }
      
      data.push({ debtPct: debt, equityIRR: irr, projectIRR: projectIRRBase });
    }
    return data;
  }, [calculations, costOfDebt, debtTerm, operationalLife]);

  // Diameter Optimization Analysis
  // Calculate full economics for each diameter option to find optimal CAPEX/OPEX tradeoff
  const diameterOptimizationData = useMemo(() => {
    const data = [];
    // massFlowRate is DESIGN capacity
    const designFlowRate = massFlowRate;
    const avgFlowRate = massFlowRate * capacityFactor;
    const flowRateKgS = (designFlowRate * 1e9) / (365.25 * 24 * 3600); // Size for design
    const volumetricFlow = flowRateKgS / ENGINEERING.density;
    
    // Common financial parameters
    const combinedTaxRate = taxableEntity ? federalTax + stateTax * (1 - federalTax) : 0;
    const stateFactor = STATE_FACTORS[state] || 1.0;
    const modelFactors = {
      'Avg': { material: 0.118, labour: 0.283, row: 0.062, misc: 0.145 },
    }['Avg'];
    
    // Calculate weighted terrain factor
    let terrainLocationFactor = 0;
    for (const [key, pct] of Object.entries(terrain)) {
      terrainLocationFactor += pct * (terrainFactors[key] || 1.0);
    }
    
    for (const d of DIAMETERS) {
      // Skip very small diameters that can't handle the flow
      const designFactor = 0.72;
      const wt = (pressure * d) / (2 * grade * 145.037738 * designFactor);
      const innerD = d - 2 * wt;
      const innerDM = innerD * 0.0254;
      
      const flowArea = Math.PI * Math.pow(innerDM / 2, 2);
      const velocity = volumetricFlow / flowArea;
      
      // Skip if velocity is way too high (unrealistic)
      if (velocity > 10) continue;
      
      // Pressure drop calculation
      const reynolds = (ENGINEERING.density * velocity * innerDM) / ENGINEERING.viscosity;
      const relativeRoughness = ENGINEERING.roughness / innerDM;
      let frictionFactor = 0.02;
      for (let i = 0; i < 10; i++) {
        const term = relativeRoughness / 3.7 + 2.51 / (reynolds * Math.sqrt(frictionFactor));
        frictionFactor = Math.pow(-2 * Math.log10(term), -2);
      }
      
      const pressureLossPaM = (frictionFactor * ENGINEERING.density * Math.pow(velocity, 2)) / (2 * innerDM);
      const frictionLossPsiMi = (pressureLossPaM * 1609.34) / 6894.76;
      
      // Include elevation pressure
      const elevationPressurePsi = elevationChange * 0.347;
      const elevationPressurePerMile = elevationPressurePsi / length;
      const effectivePressureLossPsiMi = frictionLossPsiMi + elevationPressurePerMile;
      
      const availablePressureDrop = pressure - pumpInletPressure;
      const maxPipeLengthMi = effectivePressureLossPsiMi > 0 ? availablePressureDrop / effectivePressureLossPsiMi : 999;
      const numSegments = Math.ceil(length / maxPipeLengthMi);
      const pumpStations = Math.max(1, numSegments);
      
      // Pump power
      const pumpEfficiency = 0.75;
      const pressureRisePa = availablePressureDrop * 6894.76;
      const pumpPowerPerStation = (flowRateKgS * pressureRisePa) / (ENGINEERING.density * pumpEfficiency * 1000);
      const totalPumpPower = pumpPowerPerStation * pumpStations;
      
      // CAPEX
      const diameterFactor = Math.pow(d / 8.625, 1.2);
      const referenceWallThickness = (pressure * d) / (2 * 483 * 145.037738 * 0.72);
      const wallThicknessFactor = wt / referenceWallThickness;
      const labourWeightFactor = (1 - labourWeightSensitivity) + labourWeightSensitivity * wallThicknessFactor;
      
      const material = modelFactors.material * length * diameterFactor * stateFactor;
      const labour = modelFactors.labour * length * diameterFactor * stateFactor * terrainLocationFactor * labourWeightFactor;
      const row = modelFactors.row * length * stateFactor;
      const misc = modelFactors.misc * length * diameterFactor * stateFactor;
      const pipelineCAPEX = material + labour + row + misc;
      
      const pumpFixedCost = 0.136 * pumpStations;
      const pumpVariableCost = 0.00215 * totalPumpPower;
      const pumpCAPEX = pumpFixedCost + pumpVariableCost;
      const facilitiesCAPEX = pumpCAPEX + 1.77 + 0.19; // surge tank + controls
      
      const installedCost = pipelineCAPEX + facilitiesCAPEX;
      const financingCost = installedCost * costOfDebt * (constructionLength / 12) * 0.5;
      const totalCAPEX = installedCost + financingCost;
      
      // OPEX
      const pipelineOPEX = pipelineCAPEX * 0.025;
      const facilityOPEX = facilitiesCAPEX * 0.04;
      const powerConsumption = totalPumpPower * 8760 * capacityFactor;
      const powerCost = (powerConsumption / 1000 * powerPrice) / 1e6;
      const totalOPEX = pipelineOPEX + facilityOPEX + powerCost;
      
      // NPV calculation - revenue based on AVERAGE flow
      const annualRevenue = avgFlowRate * 1e6 * costOfCO2 / 1e6;
      const annualDepreciation = totalCAPEX / depreciationYears;
      const annualEBITDA = annualRevenue - totalOPEX;
      const annualEBIT = annualEBITDA - annualDepreciation;
      const unleveredFCF = annualEBIT * (1 - combinedTaxRate) + annualDepreciation;
      
      const afterTaxCostOfDebt = costOfDebt * (1 - combinedTaxRate);
      const wacc = (debtPercent * afterTaxCostOfDebt) + ((1 - debtPercent) * costOfEquity);
      
      let projectNPV = -totalCAPEX;
      for (let yr = 1; yr <= operationalLife; yr++) {
        projectNPV += unleveredFCF / Math.pow(1 + wacc, yr);
      }
      
      // Lifetime power cost (discounted)
      const pvFactor = (1 - Math.pow(1 + wacc, -operationalLife)) / wacc;
      const lifetimePowerCost = powerCost * pvFactor;
      
      data.push({
        diameter: d,
        velocity: velocity,
        pumpStations,
        totalPumpPower,
        totalCAPEX,
        annualOPEX: totalOPEX,
        annualPowerCost: powerCost,
        lifetimePowerCost,
        projectNPV,
        pressureDrop: frictionLossPsiMi,
        isOptimal: false,
        isCurrent: d === diameter,
      });
    }
    
    // Find optimal diameter (highest NPV)
    if (data.length > 0) {
      const maxNPV = Math.max(...data.map(d => d.projectNPV));
      data.forEach(d => {
        if (d.projectNPV === maxNPV) d.isOptimal = true;
      });
    }
    
    return data;
  }, [massFlowRate, capacityFactor, length, pressure, pumpInletPressure, grade, 
      state, terrain, terrainFactors, costOfDebt, costOfEquity, debtPercent,
      federalTax, stateTax, taxableEntity, depreciationYears, operationalLife,
      constructionLength, costOfCO2, powerPrice, labourWeightSensitivity, diameter, elevationChange]);

  // Get optimal diameter recommendation
  const optimalDiameter = useMemo(() => {
    const optimal = diameterOptimizationData.find(d => d.isOptimal);
    const current = diameterOptimizationData.find(d => d.isCurrent);
    return { optimal, current };
  }, [diameterOptimizationData]);

  const formatCurrency = (val) => `$${val.toFixed(2)}MM`;
  const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

  // Input components
  const InputField = ({ label, value, onChange, unit, type = 'number', step = 1, min, max, options, className = '' }) => {
    const [localValue, setLocalValue] = useState(value);
    
    useEffect(() => {
      setLocalValue(value);
    }, [value]);
    
    const handleBlur = () => {
      if (type === 'number') {
        const numVal = parseFloat(localValue);
        if (!isNaN(numVal)) onChange(numVal);
      } else {
        onChange(localValue);
      }
    };
    
    if (options) {
      return (
        <div className={`flex items-center justify-between py-1 ${className}`}>
          <label className="text-gray-700 text-xs">{label}</label>
          <select
            value={value}
            onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) : e.target.value)}
            className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-800 text-xs focus:outline-none focus:border-green-600 min-w-[80px]"
          >
            {options.map(opt => (
              <option key={opt.value !== undefined ? opt.value : opt} value={opt.value !== undefined ? opt.value : opt}>
                {opt.label || opt}
              </option>
            ))}
          </select>
        </div>
      );
    }
    
    return (
      <div className={`flex items-center justify-between py-1 ${className}`}>
        <label className="text-gray-700 text-xs">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type={type}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
            step={step}
            min={min}
            max={max}
            className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-800 text-xs font-mono w-16 text-right focus:outline-none focus:border-green-600"
          />
          {unit && <span className="text-gray-500 text-xs w-10 text-left">{unit}</span>}
        </div>
      </div>
    );
  };

  const OutputRow = ({ label, value, unit, highlight, flag }) => (
    <div className={`flex items-center justify-between py-1 ${highlight ? 'bg-green-50' : ''}`}>
      <span className="text-gray-600 text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <span className={`font-mono text-xs ${highlight ? 'text-green-700 font-semibold' : 'text-gray-800'}`}>{value}</span>
        {unit && <span className="text-gray-400 text-xs w-8">{unit}</span>}
        {flag}
      </div>
    </div>
  );

  const Section = ({ title, children, className = '' }) => (
    <div className={`bg-white border border-gray-200 mb-2 ${className}`}>
      <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
        <h3 className="text-gray-700 font-semibold text-xs uppercase">{title}</h3>
      </div>
      <div className="p-2">{children}</div>
    </div>
  );

  const TerrainInput = ({ label, terrainKey, factor }) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-gray-700 text-xs flex-1">{label}</span>
      <span className="text-gray-400 text-xs w-10 text-center">{factor.toFixed(1)}x</span>
      <input
        type="number"
        value={(terrain[terrainKey] * 100).toFixed(0)}
        onChange={(e) => updateTerrain(terrainKey, parseFloat(e.target.value) / 100 || 0)}
        className="bg-white border border-gray-300 rounded px-1 py-0.5 text-gray-800 text-xs font-mono w-12 text-right focus:outline-none focus:border-green-600"
        step={1}
        min={0}
        max={100}
      />
      <span className="text-gray-500 text-xs w-4">%</span>
    </div>
  );

  const tabs = [
    { id: 'inputs', label: 'Inputs' },
    { id: 'charts', label: 'Charts' },
    { id: 'map', label: 'Route Map' },
    { id: 'sources', label: 'Sources' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans text-sm">
      {/* Header */}
      <div style={{ background: 'linear-gradient(to right, #5a5a4a, #6b6b5a)' }} className="text-white px-4 py-2 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="font-semibold text-sm">CO₂ Pipeline Model</span>
          <span className="text-stone-300 text-xs">|</span>
          <span className="text-stone-300 text-xs">Economic Analysis</span>
        </div>
        <button
          onClick={resetToEnverusDefaults}
          className="px-3 py-1 text-xs bg-stone-500 hover:bg-stone-400 rounded transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset to Enverus Defaults
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-300 px-4">
        <div className="flex items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-green-700 text-green-800 bg-green-50'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-4 text-xs flex-wrap">
          {/* Project Scale */}
          <div className="flex items-center gap-1" title="Total Capital Expenditure: Upfront investment including pipeline, facilities, and financing costs during construction">
            <span className="text-gray-500">CAPEX:</span>
            <span className="font-semibold text-gray-800">{formatCurrency(calculations.totalCAPEX)}</span>
          </div>
          <div className="flex items-center gap-1" title="Annual Operating Expenditure: Yearly costs including maintenance (2.5% of pipeline CAPEX), facility operations (4% of facility CAPEX), and power for pump stations">
            <span className="text-gray-500">OPEX:</span>
            <span className="font-semibold text-gray-800">{formatCurrency(calculations.totalOPEX)}/yr</span>
          </div>
          
          <span className="text-gray-300">|</span>
          
          {/* Returns */}
          <div className="flex items-center gap-1" title="Project IRR (Unlevered): Internal rate of return on total invested capital, ignoring financing structure. Measures asset quality independent of how it's financed. Green if ≥ WACC.">
            <span className="text-gray-500">Project IRR:</span>
            <span className={`font-semibold ${calculations.projectIRR >= calculations.wacc ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercent(calculations.projectIRR)}
            </span>
          </div>
          <div className="flex items-center gap-1" title="Equity IRR (Levered): Internal rate of return to equity investors after debt service. Higher than Project IRR when project returns exceed cost of debt (positive leverage). Green if ≥ Cost of Equity.">
            <span className="text-gray-500">Equity IRR:</span>
            <span className={`font-semibold ${calculations.equityIRR >= costOfEquity ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercent(calculations.equityIRR)}
            </span>
          </div>
          <div className="flex items-center gap-1" title="Net Present Value: Present value of all future cash flows minus initial investment, discounted at WACC. Positive NPV means the project creates value above the required return.">
            <span className="text-gray-500">NPV:</span>
            <span className={`font-semibold ${calculations.projectNPV >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(calculations.projectNPV)}
            </span>
          </div>
          
          <span className="text-gray-300">|</span>
          
          {/* Unit Economics */}
          <div className="flex items-center gap-1" title="Breakeven Price: Minimum transport fee per tonne to cover all costs (OPEX + debt service + required equity return grossed up for taxes). At this price, NPV = 0.">
            <span className="text-gray-500">Breakeven:</span>
            <span className="font-semibold text-gray-800">${calculations.ataxBreakeven.toFixed(2)}/t</span>
          </div>
          <div className="flex items-center gap-1" title="Margin: Profit per tonne at current transport price. Equal to (Transport Price - Breakeven). Green if positive.">
            <span className="text-gray-500">Margin:</span>
            <span className={`font-semibold ${costOfCO2 > calculations.ataxBreakeven ? 'text-green-600' : 'text-red-600'}`}>
              ${(costOfCO2 - calculations.ataxBreakeven).toFixed(2)}/t
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-3">
        {activeTab === 'inputs' && (
          <div className="grid grid-cols-4 gap-3">
            {/* Column 1: Pipeline Parameters */}
            <div>
              <Section title="Flow Parameters">
                <InputField label="Design Capacity" value={massFlowRate} onChange={setMassFlowRate} unit="Mt/yr" step={0.1} min={0.1} />
                <div className="flex items-center justify-between py-1">
                  <label className="text-gray-700 text-xs" title="Average utilization as % of design capacity. 90% = pipeline flows at 90% of max on average.">
                    Capacity Factor <span className="text-gray-400 text-[10px]">(avg/design)</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={(capacityFactor * 100).toFixed(0)}
                      onChange={(e) => setCapacityFactor(parseFloat(e.target.value) / 100)}
                      className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-800 text-xs font-mono w-16 text-right focus:outline-none focus:border-green-600"
                      step={5}
                      min={50}
                      max={100}
                    />
                    <span className="text-gray-500 text-xs w-10">%</span>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 -mt-1 mb-1">
                  Avg. flow: {(massFlowRate * capacityFactor).toFixed(2)} Mt/yr
                </div>
              </Section>
              
              <Section title="Pipeline Specs">
                <div className="flex items-center justify-between py-1">
                  <label className="text-gray-700 text-xs">
                    Diameter
                    {!diameterOverride && <span className="text-green-600 text-[9px] ml-1">(NPV-optimized)</span>}
                  </label>
                  <div className="flex items-center gap-1">
                    <select
                      value={diameter}
                      onChange={(e) => { setDiameter(parseFloat(e.target.value)); setDiameterOverride(true); }}
                      className="bg-white border border-gray-300 rounded px-1 py-0.5 text-gray-800 text-xs focus:outline-none focus:border-green-600"
                    >
                      {DIAMETERS.map(d => <option key={d} value={d}>{d}&quot;</option>)}
                    </select>
                    <span className="text-gray-500 text-xs w-10">in</span>
                  </div>
                </div>
                {diameterOverride && diameter !== npvOptimizedDiameter && (
                  <div className="text-xs text-amber-600 py-0.5 flex items-center justify-between bg-amber-50 px-1 rounded">
                    <span>NPV-Optimal: {npvOptimizedDiameter}&quot;</span>
                    <button onClick={() => { setDiameter(npvOptimizedDiameter); setDiameterOverride(false); }} className="text-green-700 hover:underline font-medium">Use</button>
                  </div>
                )}
                {diameterOverride && diameter === npvOptimizedDiameter && (
                  <div className="text-xs text-green-600 py-0.5 flex items-center justify-between">
                    <span>✓ At NPV-optimal diameter</span>
                    <button onClick={() => setDiameterOverride(false)} className="text-gray-500 hover:underline text-[10px]">Auto</button>
                  </div>
                )}
                <InputField label="Length" value={length} onChange={setLength} unit="mi" step={10} min={1} />
                <InputField label="Elevation Δ" value={elevationChange} onChange={setElevationChange} unit="ft" step={100} />
                {elevationChange !== 0 && (
                  <div className="text-[10px] text-gray-400 -mt-1 mb-1">
                    {elevationChange > 0 ? '↑' : '↓'} {Math.abs(elevationChange * 0.347).toFixed(0)} psi {elevationChange > 0 ? 'additional pressure needed' : 'pressure assist'}
                  </div>
                )}
                <div className="flex items-center justify-between py-1">
                  <label className="text-gray-700 text-xs">Grade</label>
                  <div className="flex items-center gap-1">
                    <select value={grade} onChange={(e) => setGrade(parseFloat(e.target.value))} className="bg-white border border-gray-300 rounded px-1 py-0.5 text-gray-800 text-xs">
                      {GRADES.map(g => <option key={g.name} value={g.smys}>{g.name}</option>)}
                    </select>
                    <span className="text-gray-500 text-xs w-10">MPa</span>
                  </div>
                </div>
                <InputField label="Pressure" value={pressure} onChange={setPressure} unit="psi" step={100} />
                <InputField label="Pump Inlet P" value={pumpInletPressure} onChange={setPumpInletPressure} unit="psi" step={100} />
                
                <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs text-gray-500 hover:text-gray-700 mt-1 flex items-center gap-1">
                  <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span> Advanced
                </button>
                {showAdvanced && (
                  <div className="mt-1 pl-2 border-l-2 border-gray-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Grade Cost Impact</span>
                      <div className="flex items-center gap-1">
                        <input type="range" min="-0.15" max="0.15" step="0.05" value={gradePremiumFactor} onChange={(e) => setGradePremiumFactor(parseFloat(e.target.value))} className="w-12 accent-green-600" />
                        <span className="w-8 text-right">{(gradePremiumFactor * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Labour WT Sens.</span>
                      <div className="flex items-center gap-1">
                        <input type="range" min="0" max="0.5" step="0.05" value={labourWeightSensitivity} onChange={(e) => setLabourWeightSensitivity(parseFloat(e.target.value))} className="w-12 accent-green-600" />
                        <span className="w-8 text-right">{(labourWeightSensitivity * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </Section>
              
              <Section title="Schedule">
                <InputField label="Construction Start" value={constructionStart} onChange={setConstructionStart} type="date" />
                <InputField label="Construction" value={constructionLength} onChange={setConstructionLength} unit="mo" step={1} min={1} />
                <InputField label="Op. Life" value={operationalLife} onChange={setOperationalLife} unit="yr" step={1} min={1} />
              </Section>
            </div>

            {/* Column 2: Engineering Outputs */}
            <div>
              <Section title="Engineering Outputs">
                <OutputRow 
                  label="Wall Thickness" 
                  value={calculations.wallThickness.toFixed(4)} 
                  unit="in"
                  flag={<StatusFlag value={calculations.wallThickness} thresholds={{ low: 0.1, high: 1.5 }} />}
                />
                <OutputRow label="Inner Diameter" value={calculations.innerDiameter.toFixed(3)} unit="in" />
                <OutputRow 
                  label="Flow Velocity" 
                  value={calculations.velocity.toFixed(2)} 
                  unit="m/s"
                  flag={<StatusFlag value={calculations.velocity} thresholds={{ low: 0.5, high: MAX_VELOCITY, warn: 2.5 }} />}
                />
                <OutputRow label="Friction Loss" value={calculations.frictionLoss.toFixed(1)} unit="psi/mi" />
                {elevationChange !== 0 && (
                  <OutputRow 
                    label={`Elevation ${elevationChange > 0 ? '↑' : '↓'}`} 
                    value={Math.abs(calculations.elevationPressure).toFixed(0)} 
                    unit="psi"
                    flag={Math.abs(calculations.elevationPressure) > 500 ? <StatusFlag value={600} thresholds={{ high: 500 }} /> : null}
                  />
                )}
                <OutputRow label="Total ΔP" value={calculations.totalPressureLoss.toFixed(0)} unit="psi" highlight />
                <OutputRow label="Max Segment" value={calculations.maxPipeLengthMi.toFixed(0)} unit="mi" />
                <OutputRow 
                  label="Pump Stations" 
                  value={calculations.pumpStations} 
                  unit=""
                  flag={calculations.pumpStations > 5 ? <StatusFlag value={6} thresholds={{ high: 5 }} /> : null}
                />
                <OutputRow label="Power/Station" value={calculations.pumpPowerPerStation.toFixed(0)} unit="kW" />
                <OutputRow label="Total Power" value={calculations.totalPumpPower.toFixed(0)} unit="kW" highlight />
                <OutputRow label="In-Service" value={calculations.inServiceDate} />
                {calculations.velocity > 2.5 && (
                  <div className="text-[10px] text-amber-600 mt-1 p-1 bg-amber-50 rounded">
                    ⚠ High velocity increases pressure drop. Consider larger diameter.
                  </div>
                )}
                {elevationChange > 2000 && (
                  <div className="text-[10px] text-amber-600 mt-1 p-1 bg-amber-50 rounded">
                    ⚠ Significant elevation gain (+{elevationChange} ft) adds {(elevationChange * 0.347).toFixed(0)} psi pressure requirement.
                  </div>
                )}
              </Section>

              <Section title="Cost Summary">
                <OutputRow label="Material" value={formatCurrency(calculations.material)} />
                <OutputRow label="Labour" value={formatCurrency(calculations.labour)} />
                <OutputRow label="ROW" value={formatCurrency(calculations.row)} />
                <OutputRow label="Misc" value={formatCurrency(calculations.misc)} />
                <OutputRow label="Pipeline CAPEX" value={formatCurrency(calculations.pipelineCAPEX)} highlight />
                <OutputRow label="Facilities" value={formatCurrency(calculations.facilitiesCAPEX)} />
                <OutputRow label="Financing" value={formatCurrency(calculations.financingCost)} />
                <OutputRow label="Total CAPEX" value={formatCurrency(calculations.totalCAPEX)} highlight />
              </Section>
            </div>

            {/* Column 3: Location & Terrain */}
            <div>
              <Section title="Location">
                <InputField label="State" value={state} onChange={setState} options={STATES} />
                <OutputRow label="State Factor" value={(STATE_FACTORS[state] || 1.0).toFixed(2) + 'x'} />
                <OutputRow label="Terrain Factor" value={calculations.terrainLocationFactor.toFixed(2) + 'x'} />
              </Section>

              <Section title="Terrain Mix">
                <div className="text-xs text-gray-500 mb-1 flex justify-between">
                  <span>Type</span>
                  <span className="w-10 text-center">Factor</span>
                  <span className="w-16 text-right">Percent</span>
                </div>
                <TerrainInput label="Flat/Dry" terrainKey="flatDry" factor={terrainFactors.flatDry} />
                <TerrainInput label="Rolling Hills" terrainKey="rollingHills" factor={terrainFactors.rollingHills} />
                <TerrainInput label="Mountainous" terrainKey="mountainous" factor={terrainFactors.mountainous} />
                <TerrainInput label="Marsh/Wetland" terrainKey="marshWetland" factor={terrainFactors.marshWetland} />
                <TerrainInput label="River Crossings" terrainKey="river" factor={terrainFactors.river} />
                <TerrainInput label="Existing ROW" terrainKey="existingROW" factor={terrainFactors.existingROW} />
                <TerrainInput label="High Population" terrainKey="highPopulation" factor={terrainFactors.highPopulation} />
                <TerrainInput label="Shallow Offshore" terrainKey="shallowOffshore" factor={terrainFactors.shallowOffshore} />
                <TerrainInput label="Deep Offshore" terrainKey="deepOffshore" factor={terrainFactors.deepOffshore} />
                
                <div className={`text-xs mt-1 font-semibold ${terrainValid ? 'text-green-600' : 'text-red-600'}`}>
                  Total: {(terrainTotal * 100).toFixed(0)}% {!terrainValid && '(must = 100%)'}
                </div>
                
                <button onClick={() => setShowTerrainAdvanced(!showTerrainAdvanced)} className="text-xs text-gray-500 hover:text-gray-700 mt-2 flex items-center gap-1">
                  <span className={`transform transition-transform ${showTerrainAdvanced ? 'rotate-90' : ''}`}>▶</span> Adjust Cost Factors
                </button>
                {showTerrainAdvanced && (
                  <div className="mt-1 p-2 bg-gray-50 rounded text-xs space-y-1">
                    {Object.entries(terrainFactors).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                        <input
                          type="number"
                          value={val}
                          onChange={(e) => updateTerrainFactor(key, parseFloat(e.target.value) || 1)}
                          className="w-14 border rounded px-1 py-0.5 text-right"
                          step={0.1}
                          min={0.5}
                          max={10}
                        />
                      </div>
                    ))}
                    <button onClick={resetTerrainFactors} className="text-green-700 hover:underline mt-1">Reset to Defaults</button>
                  </div>
                )}
              </Section>
            </div>

            {/* Column 4: Financial */}
            <div>
              <Section title="Revenue & Costs">
                <InputField label="CO₂ Price" value={costOfCO2} onChange={setCostOfCO2} unit="$/t" step={5} />
                <InputField label="Power Price" value={powerPrice} onChange={setPowerPrice} unit="$/MWh" step={10} />
                <InputField label="Cost Model" value={economicModel} onChange={setEconomicModel} options={MODELS} />
              </Section>
              
              <Section title="Capital Structure">
                <InputField label="Debt %" value={(debtPercent * 100).toFixed(0)} onChange={(v) => setDebtPercent(v / 100)} unit="%" step={5} min={0} max={100} />
                <InputField label="Debt Term" value={debtTerm} onChange={setDebtTerm} unit="yr" step={1} min={1} />
                <InputField label="Cost of Debt" value={(costOfDebt * 100).toFixed(2)} onChange={(v) => setCostOfDebt(v / 100)} unit="%" step={0.25} />
                <InputField label="Cost of Equity" value={(costOfEquity * 100).toFixed(1)} onChange={(v) => setCostOfEquity(v / 100)} unit="%" step={0.5} />
                <OutputRow label="WACC" value={formatPercent(calculations.wacc)} highlight />
              </Section>
              
              <Section title="Tax & Depreciation">
                <div className="flex items-center justify-between py-1">
                  <label className="text-gray-700 text-xs">Taxable Entity</label>
                  <input type="checkbox" checked={taxableEntity} onChange={(e) => setTaxableEntity(e.target.checked)} className="rounded accent-green-600" />
                </div>
                {taxableEntity && (
                  <>
                    <InputField label="Federal Tax" value={(federalTax * 100).toFixed(0)} onChange={(v) => setFederalTax(v / 100)} unit="%" step={1} />
                    <InputField label="State Tax" value={(stateTax * 100).toFixed(1)} onChange={(v) => setStateTax(v / 100)} unit="%" step={0.5} />
                    <OutputRow label="Combined Rate" value={formatPercent(calculations.combinedTaxRate)} />
                    <InputField label="Depr. Period" value={depreciationYears} onChange={setDepreciationYears} unit="yr" step={1} min={1} />
                  </>
                )}
              </Section>
              
              <Section title="Escalation">
                <InputField label="Cost Base Year" value={costBaseYear} onChange={setCostBaseYear} unit="" step={1} min={2020} max={2050} />
                <InputField label="General Inflation" value={(generalInflation * 100).toFixed(1)} onChange={(v) => setGeneralInflation(v / 100)} unit="%/yr" step={0.5} />
                <InputField label="Labor Escalation" value={(laborEscalation * 100).toFixed(1)} onChange={(v) => setLaborEscalation(v / 100)} unit="%/yr" step={0.5} />
                <InputField label="Power Escalation" value={(powerEscalation * 100).toFixed(1)} onChange={(v) => setPowerEscalation(v / 100)} unit="%/yr" step={0.5} />
                <InputField label="Revenue Escalation" value={(revenueEscalation * 100).toFixed(1)} onChange={(v) => setRevenueEscalation(v / 100)} unit="%/yr" step={0.5} />
                {calculations.yearsToConstruction > 0 && (
                  <div className="text-[10px] text-gray-500 mt-1 p-1 bg-gray-50 rounded">
                    CAPEX escalated {calculations.yearsToConstruction.toFixed(1)} yrs: General ×{calculations.generalEscalationFactor.toFixed(3)}, Labor ×{calculations.laborEscalationFactor.toFixed(3)}
                  </div>
                )}
              </Section>
              
              <Section title="Key Metrics">
                <OutputRow label="Equity IRR" value={formatPercent(calculations.equityIRR)} highlight />
                <OutputRow label="Project IRR" value={formatPercent(calculations.projectIRR)} highlight />
                <OutputRow label="Equity NPV" value={formatCurrency(calculations.equityNPV)} />
                <OutputRow label="Project NPV" value={formatCurrency(calculations.projectNPV)} />
                <OutputRow label="Breakeven" value={`$${calculations.ataxBreakeven.toFixed(2)}/t`} highlight />
                <OutputRow label="DSCR" value={calculations.dscr.toFixed(2) + 'x'} flag={<StatusFlag value={calculations.dscr} thresholds={{ low: 1.2 }} />} />
                <OutputRow label="Payback" value={calculations.paybackMonths + ' mo'} />
              </Section>
            </div>
          </div>
        )}

        {activeTab === 'charts' && (
          <div className="grid grid-cols-3 gap-3">
            {/* CAPEX Pie */}
            <div className="bg-white border border-gray-200">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">CAPEX Breakdown</h3>
              </div>
              <div className="p-2">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={capexData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {capexData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center text-xs text-gray-600">Total: <span className="font-semibold">{formatCurrency(calculations.totalCAPEX)}</span></div>
              </div>
            </div>

            {/* OPEX Bar */}
            <div className="bg-white border border-gray-200">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">OPEX Breakdown</h3>
              </div>
              <div className="p-2">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={opexData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v.toFixed(1)}MM`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={70} />
                      <Tooltip formatter={(v) => formatCurrency(v)} />
                      <Bar dataKey="value" fill="#6b8e23" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center text-xs text-gray-600">Total: <span className="font-semibold">{formatCurrency(calculations.totalOPEX)}/yr</span></div>
              </div>
            </div>

            {/* Cost per Tonne */}
            <div className="bg-white border border-gray-200">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">Breakeven Breakdown</h3>
              </div>
              <div className="p-2">
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={costPerTonneData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={85} />
                      <Tooltip formatter={(v) => `$${v.toFixed(2)}/t`} />
                      <Bar dataKey="value" fill="#6b8e23">
                        {costPerTonneData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Sensitivity - Tornado Chart */}
            <div className="bg-white border border-gray-200 col-span-2">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">NPV Sensitivity Tornado (±25%)</h3>
              </div>
              <div className="p-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={sensitivityData} 
                      layout="vertical"
                      margin={{ left: 10, right: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        type="number" 
                        tick={{ fontSize: 9 }} 
                        tickFormatter={(v) => `${v >= 0 ? '+' : ''}$${v.toFixed(0)}MM`}
                        domain={['auto', 'auto']}
                      />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        tick={{ fontSize: 9 }} 
                        width={85}
                        axisLine={false}
                      />
                      <Tooltip 
                        formatter={(v, name) => [`${v >= 0 ? '+' : ''}${formatCurrency(v)}`, name === 'low' ? '-25%' : '+25%']}
                        labelFormatter={(label) => `${label}`}
                      />
                      <ReferenceLine x={0} stroke="#666" strokeWidth={1} />
                      <Bar dataKey="low" fill="#dc2626" name="-25%" radius={[4, 0, 0, 4]} />
                      <Bar dataKey="high" fill="#16a34a" name="+25%" radius={[0, 4, 4, 0]} />
                      <Legend 
                        wrapperStyle={{ fontSize: 10 }} 
                        formatter={(value) => value === 'low' ? 'Parameter -25%' : 'Parameter +25%'}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-gray-500 text-center mt-1">
                  Sorted by impact magnitude. Base NPV: {formatCurrency(calculations.projectNPV)}
                </div>
              </div>
            </div>

            {/* Breakeven vs Distance */}
            <div className="bg-white border border-gray-200">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">Breakeven vs Distance</h3>
              </div>
              <div className="p-2">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={breakevenByDistanceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="distance" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(v) => `$${v.toFixed(2)}/t`} labelFormatter={(l) => `${l} mi`} />
                      <Line type="monotone" dataKey="breakeven" stroke="#6b8e23" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* IRR vs Leverage */}
            <div className="bg-white border border-gray-200">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">IRR vs Leverage</h3>
              </div>
              <div className="p-2">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={leverageData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="debtPct" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                      <Tooltip formatter={(v) => formatPercent(v)} labelFormatter={(l) => `${l}% Debt`} />
                      <Line type="monotone" dataKey="equityIRR" stroke="#6b8e23" strokeWidth={2} dot={false} name="Equity IRR" />
                      <Line type="monotone" dataKey="projectIRR" stroke="#808080" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Project IRR" />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Diameter Optimization - full width */}
            <div className="bg-white border border-gray-200 col-span-3">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">Diameter Optimization (CAPEX vs OPEX Tradeoff)</h3>
                <div className="flex items-center gap-2">
                  {!diameterOverride && (
                    <span className="text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded">
                      ✓ Auto-optimizing for NPV
                    </span>
                  )}
                  {diameterOverride && (
                    <button
                      onClick={() => setDiameterOverride(false)}
                      className="px-2 py-0.5 text-[10px] bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Enable Auto-Optimization
                    </button>
                  )}
                </div>
              </div>
              <div className="p-2">
                <div className="grid grid-cols-2 gap-4">
                  {/* Chart */}
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={diameterOptimizationData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis 
                          dataKey="diameter" 
                          tick={{ fontSize: 9 }} 
                          tickFormatter={(v) => `${v}"`}
                          label={{ value: 'Diameter (in)', position: 'insideBottom', offset: -3, fontSize: 9 }}
                        />
                        <YAxis 
                          yAxisId="left"
                          tick={{ fontSize: 9 }} 
                          tickFormatter={(v) => `$${v.toFixed(0)}MM`}
                          label={{ value: 'Cost ($MM)', angle: -90, position: 'insideLeft', fontSize: 9 }}
                        />
                        <YAxis 
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 9 }} 
                          tickFormatter={(v) => v}
                          label={{ value: 'Pump Stations', angle: 90, position: 'insideRight', fontSize: 9 }}
                        />
                        <Tooltip 
                          formatter={(v, name) => {
                            if (name === 'pumpStations') return [v, 'Pump Stations'];
                            return [formatCurrency(v), name === 'totalCAPEX' ? 'CAPEX' : name === 'lifetimePowerCost' ? 'Lifetime Power Cost' : 'NPV'];
                          }}
                          labelFormatter={(v) => `${v}" Diameter`}
                        />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Bar yAxisId="left" dataKey="totalCAPEX" fill="#6b8e23" name="CAPEX" />
                        <Bar yAxisId="left" dataKey="lifetimePowerCost" fill="#f59e0b" name="Lifetime Power" />
                        <Line yAxisId="right" type="monotone" dataKey="pumpStations" stroke="#dc2626" strokeWidth={2} dot name="Pump Stations" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Table */}
                  <div className="overflow-auto max-h-56">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold text-gray-700">Dia.</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">Vel.</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">Pumps</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">Power</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">CAPEX</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">OPEX/yr</th>
                          <th className="px-2 py-1 text-right font-semibold text-gray-700">NPV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diameterOptimizationData.map((row) => (
                          <tr 
                            key={row.diameter} 
                            className={`border-b border-gray-100 ${row.isOptimal ? 'bg-green-100 font-semibold' : ''} ${row.isCurrent ? 'bg-blue-50' : ''}`}
                          >
                            <td className="px-2 py-1">
                              {row.diameter}&quot;
                              {row.isOptimal && <span className="ml-1 text-green-600">★</span>}
                              {row.isCurrent && <span className="ml-1 text-blue-600">●</span>}
                            </td>
                            <td className={`px-2 py-1 text-right ${row.velocity > 3 ? 'text-red-600' : row.velocity > 2.5 ? 'text-amber-600' : ''}`}>
                              {row.velocity.toFixed(1)} m/s
                            </td>
                            <td className="px-2 py-1 text-right">{row.pumpStations}</td>
                            <td className="px-2 py-1 text-right">{row.totalPumpPower.toFixed(0)} kW</td>
                            <td className="px-2 py-1 text-right">{formatCurrency(row.totalCAPEX)}</td>
                            <td className="px-2 py-1 text-right">{formatCurrency(row.annualOPEX)}</td>
                            <td className={`px-2 py-1 text-right ${row.projectNPV >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(row.projectNPV)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-[10px] text-gray-500 mt-2 px-2">
                      <span className="text-green-600">★</span> = NPV-Optimal | 
                      <span className="text-blue-600 ml-1">●</span> = Current Selection |
                      <span className="text-red-600 ml-1">Red velocity</span> = Above 3 m/s limit
                    </div>
                  </div>
                </div>
                
                {/* Optimization Summary */}
                {optimalDiameter.optimal && optimalDiameter.current && (
                  <div className={`mt-3 p-2 rounded text-xs ${
                    optimalDiameter.optimal.diameter === optimalDiameter.current.diameter 
                      ? 'bg-green-50 border border-green-200' 
                      : 'bg-amber-50 border border-amber-200'
                  }`}>
                    {optimalDiameter.optimal.diameter === optimalDiameter.current.diameter ? (
                      <div className="text-green-800">
                        ✓ <strong>{diameterOverride ? 'Selected' : 'Auto-selected'} diameter ({diameter}&quot;) is NPV-optimal</strong> for this configuration — 
                        CAPEX: {formatCurrency(optimalDiameter.current.totalCAPEX)}, 
                        {optimalDiameter.current.pumpStations} pump station(s), 
                        {formatCurrency(optimalDiameter.current.annualPowerCost)}/yr power cost, 
                        velocity: {optimalDiameter.current.velocity.toFixed(1)} m/s.
                      </div>
                    ) : (
                      <div className="text-amber-800">
                        ⚠ <strong>Manual override active</strong> — Current {diameter}&quot; has NPV of {formatCurrency(optimalDiameter.current.projectNPV)}.
                        Optimal {optimalDiameter.optimal.diameter}&quot; would improve NPV by {formatCurrency(optimalDiameter.optimal.projectNPV - optimalDiameter.current.projectNPV)} 
                        ({optimalDiameter.optimal.pumpStations} vs {optimalDiameter.current.pumpStations} pump stations, 
                        {formatCurrency(Math.abs(optimalDiameter.current.annualPowerCost - optimalDiameter.optimal.annualPowerCost))}/yr {optimalDiameter.optimal.annualPowerCost < optimalDiameter.current.annualPowerCost ? 'power savings' : 'additional power cost'}).
                        <button 
                          onClick={() => setDiameterOverride(false)} 
                          className="ml-2 text-green-700 underline font-medium"
                        >
                          Enable auto-optimization
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Cash Flow - full width */}
            <div className="bg-white border border-gray-200 col-span-3">
              <div className="bg-gray-100 px-2 py-1 border-b border-gray-200">
                <h3 className="text-gray-700 font-semibold text-xs uppercase">Cumulative Free Cash Flow to Equity</h3>
              </div>
              <div className="p-2">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cashFlowData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="year" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v.toFixed(0)}MM`} />
                      <Tooltip formatter={(v) => formatCurrency(v)} labelFormatter={(l) => `Year ${l}`} />
                      <Area type="monotone" dataKey="cumulative" stroke="#6b8e23" fill="#6b8e23" fillOpacity={0.3} name="Cumulative FCFE" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <TexasMapDemo 
            mapPoints={mapPoints}
            setMapPoints={setMapPoints}
            isDrawing={isDrawing}
            setIsDrawing={setIsDrawing}
            setTerrain={setTerrain}
            setLength={setLength}
            calculations={calculations}
            formatCurrency={formatCurrency}
          />
        )}

        {activeTab === 'sources' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white border border-gray-200 rounded">
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
                <h2 className="text-gray-700 font-semibold text-sm uppercase">Sources & Methodology</h2>
              </div>
              <div className="p-4 space-y-6 text-xs text-gray-700">
                
                {/* CAPEX Model */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Pipeline CAPEX Model</h3>
                  <p className="mb-2">Cost estimation based on regression analysis of historical pipeline construction data, using the general form:</p>
                  <p className="bg-gray-50 p-2 rounded font-mono text-[11px] mb-2">
                    CAPEX = (Material + Labour + ROW + Misc) × Diameter Factor × State Factor × Terrain Factor
                  </p>
                  <table className="w-full border-collapse text-[11px] mb-2">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Component</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Base ($/mi)</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">Material</td><td className="border border-gray-200 px-2 py-1">$118,000</td><td className="border border-gray-200 px-2 py-1">Industry average, 8.625" baseline</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Labour</td><td className="border border-gray-200 px-2 py-1">$283,000</td><td className="border border-gray-200 px-2 py-1">FERC Form 2 filings, adjusted for terrain</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">ROW</td><td className="border border-gray-200 px-2 py-1">$62,000</td><td className="border border-gray-200 px-2 py-1">BLM rates, state land office data</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Miscellaneous</td><td className="border border-gray-200 px-2 py-1">$145,000</td><td className="border border-gray-200 px-2 py-1">Engineering, survey, contingency</td></tr>
                    </tbody>
                  </table>
                  <p className="text-gray-500 italic">Diameter factor scales as (D/8.625)^1.2 based on steel weight and installation complexity.</p>
                </div>

                {/* Terrain Factors */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Terrain Cost Multipliers</h3>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Terrain Type</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Multiplier</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">Flat/Dry</td><td className="border border-gray-200 px-2 py-1">1.0x</td><td className="border border-gray-200 px-2 py-1">Baseline - standard trenching</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Rolling Hills</td><td className="border border-gray-200 px-2 py-1">1.3x</td><td className="border border-gray-200 px-2 py-1">Increased grading, equipment access</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Mountainous</td><td className="border border-gray-200 px-2 py-1">1.8x</td><td className="border border-gray-200 px-2 py-1">Rock excavation, steep grades, limited access</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Marsh/Wetland</td><td className="border border-gray-200 px-2 py-1">1.5x</td><td className="border border-gray-200 px-2 py-1">Specialized equipment, environmental mitigation</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">River Crossing</td><td className="border border-gray-200 px-2 py-1">2.2x</td><td className="border border-gray-200 px-2 py-1">HDD or open-cut crossing, permitting</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Existing ROW</td><td className="border border-gray-200 px-2 py-1">2.2x</td><td className="border border-gray-200 px-2 py-1">HDD under existing pipelines, coordination</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">High Population</td><td className="border border-gray-200 px-2 py-1">1.6x</td><td className="border border-gray-200 px-2 py-1">Class 3/4 design, additional safety measures</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Shallow Offshore</td><td className="border border-gray-200 px-2 py-1">2.5x</td><td className="border border-gray-200 px-2 py-1">&lt;200ft depth, marine installation</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Deep Offshore</td><td className="border border-gray-200 px-2 py-1">4.0x</td><td className="border border-gray-200 px-2 py-1">&gt;200ft depth, specialized vessels</td></tr>
                    </tbody>
                  </table>
                  <p className="text-gray-500 italic mt-1">Sources: INGAA Foundation studies, PHMSA data, offshore industry benchmarks.</p>
                </div>

                {/* Engineering Parameters */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Engineering Parameters</h3>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Parameter</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Value</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">CO₂ Density (dense phase)</td><td className="border border-gray-200 px-2 py-1">800 kg/m³</td><td className="border border-gray-200 px-2 py-1">NIST, at typical operating conditions</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">CO₂ Viscosity</td><td className="border border-gray-200 px-2 py-1">0.00006 Pa·s</td><td className="border border-gray-200 px-2 py-1">NIST thermophysical properties</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Pipe Roughness</td><td className="border border-gray-200 px-2 py-1">0.0457 mm</td><td className="border border-gray-200 px-2 py-1">Commercial steel pipe standard</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Design Factor</td><td className="border border-gray-200 px-2 py-1">0.72</td><td className="border border-gray-200 px-2 py-1">ASME B31.4 / 49 CFR 195</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Pump Efficiency</td><td className="border border-gray-200 px-2 py-1">75%</td><td className="border border-gray-200 px-2 py-1">Typical centrifugal pump performance</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Target Velocity</td><td className="border border-gray-200 px-2 py-1">2.0 m/s</td><td className="border border-gray-200 px-2 py-1">Industry practice, balancing erosion/pressure drop</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Velocity Limits</td><td className="border border-gray-200 px-2 py-1">0.5 - 3.0 m/s</td><td className="border border-gray-200 px-2 py-1">Min: avoid deposition; Max: erosion limit</td></tr>
                    </tbody>
                  </table>
                  
                  <h4 className="font-semibold text-xs text-gray-700 mt-3 mb-1">Pressure Drop Components</h4>
                  <p className="text-[11px] mb-2">Total pressure drop = Friction + Elevation</p>
                  <table className="w-full border-collapse text-[11px]">
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1 font-medium">Friction</td><td className="border border-gray-200 px-2 py-1">Darcy-Weisbach: ΔP = f × (L/D) × (ρv²/2)</td><td className="border border-gray-200 px-2 py-1">Colebrook-White friction factor</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1 font-medium">Elevation</td><td className="border border-gray-200 px-2 py-1">ΔP = ρ × g × Δh = 0.347 psi/ft</td><td className="border border-gray-200 px-2 py-1">Hydrostatic head for 800 kg/m³ CO₂</td></tr>
                    </tbody>
                  </table>
                  <p className="text-gray-500 italic mt-1">Example: 3,000 ft elevation gain requires ~1,040 psi additional pressure, equivalent to several pump stations.</p>
                </div>

                {/* Facilities */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Facility Costs</h3>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Facility</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Cost</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">Pump Station (fixed)</td><td className="border border-gray-200 px-2 py-1">$136,000/station</td><td className="border border-gray-200 px-2 py-1">Site prep, buildings, controls</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Pump Station (variable)</td><td className="border border-gray-200 px-2 py-1">$2,150/kW</td><td className="border border-gray-200 px-2 py-1">Pump + motor + VFD, installed</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Surge Tank</td><td className="border border-gray-200 px-2 py-1">$1,770,000</td><td className="border border-gray-200 px-2 py-1">Pressure protection system</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Control Systems</td><td className="border border-gray-200 px-2 py-1">$190,000</td><td className="border border-gray-200 px-2 py-1">SCADA, communications, metering</td></tr>
                    </tbody>
                  </table>
                </div>

                {/* OPEX */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Operating Cost Assumptions</h3>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Category</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Rate</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Basis</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">Pipeline O&M</td><td className="border border-gray-200 px-2 py-1">2.5% of pipeline CAPEX/yr</td><td className="border border-gray-200 px-2 py-1">Industry benchmark, includes integrity management</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Facility O&M</td><td className="border border-gray-200 px-2 py-1">4.0% of facility CAPEX/yr</td><td className="border border-gray-200 px-2 py-1">Higher due to rotating equipment</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Power</td><td className="border border-gray-200 px-2 py-1">kW × hours × price</td><td className="border border-gray-200 px-2 py-1">Based on pump power and capacity factor</td></tr>
                    </tbody>
                  </table>
                </div>

                {/* Financial */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Financial Assumptions (Defaults)</h3>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-2 py-1 text-left">Parameter</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Default</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="border border-gray-200 px-2 py-1">Debt / Equity</td><td className="border border-gray-200 px-2 py-1">60% / 40%</td><td className="border border-gray-200 px-2 py-1">Typical infrastructure project financing</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Cost of Debt</td><td className="border border-gray-200 px-2 py-1">6.5%</td><td className="border border-gray-200 px-2 py-1">Investment grade corporate + spread</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Cost of Equity</td><td className="border border-gray-200 px-2 py-1">12%</td><td className="border border-gray-200 px-2 py-1">Infrastructure equity return expectation</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Debt Term</td><td className="border border-gray-200 px-2 py-1">20 years</td><td className="border border-gray-200 px-2 py-1">Long-term project finance</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Federal Tax Rate</td><td className="border border-gray-200 px-2 py-1">21%</td><td className="border border-gray-200 px-2 py-1">US corporate tax rate</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">State Tax Rate</td><td className="border border-gray-200 px-2 py-1">5%</td><td className="border border-gray-200 px-2 py-1">Varies by state (TX = 0%, LA = 7.5%)</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Depreciation</td><td className="border border-gray-200 px-2 py-1">15 years</td><td className="border border-gray-200 px-2 py-1">MACRS pipeline asset class</td></tr>
                      <tr><td className="border border-gray-200 px-2 py-1">Project Life</td><td className="border border-gray-200 px-2 py-1">30 years</td><td className="border border-gray-200 px-2 py-1">Typical pipeline economic life</td></tr>
                    </tbody>
                  </table>
                </div>

                {/* State Factors */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">State Cost Factors</h3>
                  <p className="mb-2">Regional cost adjustments based on labor rates, regulatory environment, and historical project costs:</p>
                  <div className="grid grid-cols-4 gap-2 text-[11px]">
                    <div className="bg-gray-50 p-2 rounded"><strong>TX:</strong> 1.00 (baseline)</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>LA:</strong> 1.05</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>OK:</strong> 0.95</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>NM:</strong> 1.02</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>CO:</strong> 1.15</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>WY:</strong> 1.08</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>ND:</strong> 1.12</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>KS:</strong> 0.98</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>MT:</strong> 1.10</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>CA:</strong> 1.35</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>IL:</strong> 1.18</div>
                    <div className="bg-gray-50 p-2 rounded"><strong>MS:</strong> 1.00</div>
                  </div>
                </div>

                {/* References */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-800 mb-2">Key References</h3>
                  <ul className="list-disc list-inside space-y-1 text-[11px]">
                    <li>INGAA Foundation, "Pipeline Construction Cost Trends" (2019-2023)</li>
                    <li>NETL, "FE/NETL CO2 Transport Cost Model" (2022)</li>
                    <li>IEA Greenhouse Gas R&D Programme, "CO2 Pipeline Infrastructure" (2014)</li>
                    <li>FERC Form 2 Annual Reports - Pipeline Cost Data</li>
                    <li>PHMSA Pipeline Safety Data</li>
                    <li>ASME B31.4 - Pipeline Transportation Systems for Liquids</li>
                    <li>49 CFR 195 - Transportation of Hazardous Liquids by Pipeline</li>
                    <li>NIST Thermophysical Properties Database (CO2 properties)</li>
                    <li>EIA Annual Energy Outlook (power prices)</li>
                  </ul>
                </div>

                {/* Disclaimer */}
                <div className="bg-amber-50 border border-amber-200 rounded p-3">
                  <h3 className="font-semibold text-sm text-amber-800 mb-1">Disclaimer</h3>
                  <p className="text-[11px] text-amber-700">
                    This model provides screening-level cost estimates for preliminary project evaluation. Actual costs 
                    will vary based on site-specific conditions, market conditions, regulatory requirements, and detailed 
                    engineering. Professional engineering and financial analysis is required for investment decisions.
                    Cost data reflects 2023-2024 market conditions and should be adjusted for inflation and market changes.
                  </p>
                </div>

              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-200 border-t border-gray-300 px-4 py-2 text-xs text-gray-500 text-center">
        CO₂ Pipeline Economic Model • v2.0 • All calculations are estimates
      </div>
    </div>
  );
}
