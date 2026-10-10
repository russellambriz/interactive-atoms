// Static chemistry data: elements, bonds, molecule names.

// Scale: world units per Ångström (atoms are drawn far larger than reality so
// the nucleus, shells and bonds are all readable at the same time).
export const ANGSTROM = 3.0;

export const ELEMENTS = {
  H: {
    symbol: 'H', name: 'Hydrogen', Z: 1, N: 0, mass: 1.008, valence: 1,
    config: [['1s', 1]], configText: '1s¹', en: 2.20,
    covalent: [0.31, 0.31, 0.31], color: '#e8f1ff', glow: 0xbfd8ff,
    massPhys: 1.0, size: 1.5, group: 1, period: 1, category: 'Nonmetal',
    facts: [
      'Most abundant element in the universe (~74% of normal matter by mass).',
      'Protium (¹H) has no neutron – its nucleus is a single proton.',
      'Forms exactly one covalent bond.'
    ]
  },
  C: {
    symbol: 'C', name: 'Carbon', Z: 6, N: 6, mass: 12.011, valence: 4,
    config: [['1s', 2], ['2s', 2], ['2p', 2]], configText: '1s² 2s² 2p²', en: 2.55,
    covalent: [0.76, 0.67, 0.60], color: '#9aa4b5', glow: 0xd0d8e8,
    massPhys: 4.0, size: 2.6, group: 14, period: 2, category: 'Nonmetal',
    facts: [
      'Atomic number 6 · standard atomic weight 12.011 u.',
      'Isotopes: ¹²C 98.9%, ¹³C 1.1%, ¹⁴C trace (t½ ≈ 5,730 y, used in radiocarbon dating).',
      'Valence 4: promotes a 2s electron and hybridizes (sp³ / sp² / sp) to form 4 bonds.',
      'Allotropes: diamond, graphite, graphene, fullerenes, nanotubes.',
      'Backbone of all known life – the basis of organic chemistry.'
    ]
  },
  N: {
    symbol: 'N', name: 'Nitrogen', Z: 7, N: 7, mass: 14.007, valence: 3,
    config: [['1s', 2], ['2s', 2], ['2p', 3]], configText: '1s² 2s² 2p³', en: 3.04,
    covalent: [0.71, 0.60, 0.54], color: '#6f9bff', glow: 0x8fb0ff,
    massPhys: 4.5, size: 2.5, group: 15, period: 2, category: 'Nonmetal',
    facts: [
      '78% of Earth’s atmosphere is N₂, held together by a very strong triple bond (945 kJ/mol).',
      'Valence 3 with one lone pair (e.g. NH₃ is trigonal pyramidal, ~107°).',
      'Essential in amino acids, DNA and RNA.'
    ]
  },
  O: {
    symbol: 'O', name: 'Oxygen', Z: 8, N: 8, mass: 15.999, valence: 2,
    config: [['1s', 2], ['2s', 2], ['2p', 4]], configText: '1s² 2s² 2p⁴', en: 3.44,
    covalent: [0.66, 0.57, 0.53], color: '#ff5a5a', glow: 0xff8080,
    massPhys: 5.0, size: 2.4, group: 16, period: 2, category: 'Nonmetal',
    facts: [
      'Second most electronegative element (3.44 Pauling).',
      'Valence 2 with two lone pairs (H₂O is bent, ~104.5°).',
      'Most abundant element in Earth’s crust by mass (~46%).'
    ]
  }
};

export const PARTICLES = {
  proton: { name: 'Proton', sym: 'p⁺', charge: '+1 e', mass: '1.007276 u', extra: 'Quarks: up · up · down', },
  neutron: { name: 'Neutron', sym: 'n⁰', charge: '0', mass: '1.008665 u', extra: 'Quarks: up · down · down' },
  electron: { name: 'Electron', sym: 'e⁻', charge: '−1 e', mass: '0.000549 u (1/1836 of a proton)', extra: 'Lepton, spin ½' }
};

// Average bond enthalpies in kJ/mol, keyed by sorted symbols + order.
const BE = {
  'CH1': 413, 'CC1': 348, 'CC2': 614, 'CC3': 839, 'CO1': 358, 'CO2': 799, 'CO3': 1072,
  'CN1': 293, 'CN2': 615, 'CN3': 891, 'HO1': 463, 'HN1': 391, 'HH1': 436,
  'OO1': 146, 'OO2': 498, 'NN1': 163, 'NN2': 418, 'NN3': 945, 'NO1': 201, 'NO2': 607
};
export function bondKey(a, b) { return [a, b].sort().join(''); }
export function bondEnergy(a, b, order) { return BE[bondKey(a, b) + order] ?? 300; }
export function bondLengthA(a, b, order) {
  const i = Math.min(order, 3) - 1;
  return ELEMENTS[a].covalent[i] + ELEMENTS[b].covalent[i];
}

// Molecule names keyed by Hill formula (plain text, no subscripts).
// display: conventional formula when it differs from Hill order.
export const MOLECULES = {
  'H2': { name: 'Hydrogen gas', shape: 'linear' },
  'O2': { name: 'Oxygen gas', shape: 'linear, O=O double bond' },
  'N2': { name: 'Nitrogen gas', shape: 'linear, N≡N triple bond' },
  'H2O': { name: 'Water', shape: 'bent ~104.5°' },
  'H2O2': { name: 'Hydrogen peroxide', shape: 'skewed chain' },
  'H3N': { name: 'Ammonia', display: 'NH3', shape: 'trigonal pyramidal ~107°' },
  'H4N2': { name: 'Hydrazine', display: 'N2H4', shape: 'chain' },
  'H2N2': { name: 'Diazene', display: 'N2H2', shape: 'planar' },
  'HNO': { name: 'Nitroxyl', shape: 'bent' },
  'CH4': { name: 'Methane', shape: 'tetrahedral 109.5° (sp³)' },
  'C2H6': { name: 'Ethane', shape: 'two tetrahedral carbons' },
  'C2H4': { name: 'Ethylene', shape: 'trigonal planar 120° (sp²)' },
  'C2H2': { name: 'Acetylene', shape: 'linear 180° (sp)' },
  'C3H8': { name: 'Propane', shape: 'zig-zag chain' },
  'C3H6': { name: 'Propene', shape: 'chain with C=C' },
  'C3H4': { name: 'Propyne / Allene', shape: 'linear segment' },
  'C4H10': { name: 'Butane', shape: 'zig-zag chain' },
  'C5H12': { name: 'Pentane', shape: 'zig-zag chain' },
  'CO2': { name: 'Carbon dioxide', shape: 'linear 180°, two C=O' },
  'CO': { name: 'Carbon monoxide', shape: 'linear' },
  'CH2O': { name: 'Formaldehyde', shape: 'trigonal planar' },
  'CH4O': { name: 'Methanol', display: 'CH3OH', shape: 'tetrahedral C' },
  'CH2O2': { name: 'Formic acid', display: 'HCOOH', shape: 'planar' },
  'CH2O3': { name: 'Carbonic acid', display: 'H2CO3', shape: 'planar' },
  'CHN': { name: 'Hydrogen cyanide', display: 'HCN', shape: 'linear 180°, C≡N' },
  'CH5N': { name: 'Methylamine', display: 'CH3NH2', shape: 'tetrahedral C' },
  'CH3N': { name: 'Methanimine', display: 'CH2NH', shape: 'planar' },
  'CH4N2O': { name: 'Urea', display: 'CO(NH2)2', shape: 'planar' },
  'C2N2': { name: 'Cyanogen', display: 'NCCN', shape: 'linear' },
  'C2H6O': { name: 'Ethanol', shape: 'chain' },
  'C2H4O2': { name: 'Acetic acid', shape: 'planar carboxyl' },
  'C2H4O': { name: 'Acetaldehyde', shape: 'planar carbonyl' },
  'C3H6O': { name: 'Acetone / Propanal', shape: 'carbonyl' },
  'CH3': { name: 'Methyl radical', shape: 'radical' },
  'CH2': { name: 'Methylene (carbene)', shape: 'radical' },
  'CH': { name: 'Methylidyne radical', shape: 'radical' },
  'HO': { name: 'Hydroxyl radical', display: 'OH', shape: 'radical' },
  'H2N': { name: 'Amino radical', display: 'NH2', shape: 'radical' },
  'HN': { name: 'Imidogen radical', display: 'NH', shape: 'radical' },
  'NO': { name: 'Nitric oxide', shape: 'radical' },
  'O3': { name: 'Ozone (simplified)', shape: 'bent' },
  'C2': { name: 'Dicarbon', shape: 'linear' },
  'C': { name: 'Carbon atom', shape: '4 free valence electrons' },
  'H': { name: 'Hydrogen atom', shape: '1 free valence electron' },
  'N': { name: 'Nitrogen atom', shape: '3 free valence electrons' },
  'O': { name: 'Oxygen atom', shape: '2 free valence electrons' }
};

const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
export function subscript(f) { return f.replace(/\d/g, d => SUB[d]); }
