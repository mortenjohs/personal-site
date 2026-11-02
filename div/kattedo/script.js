const unitInputs = document.querySelectorAll('input[name="unit"]');
const catSizeInput = document.getElementById('cat-size');
const lengthInput = document.getElementById('length');
const widthInput = document.getElementById('width');

const catSizeLabel = document.querySelector('label[for="cat-size"]');
const lengthLabel = document.querySelector('label[for="length"]');
const widthLabel = document.querySelector('label[for="width"]');

const catSizeVal = document.getElementById('cat-size-val');
const lengthVal = document.getElementById('length-val');
const widthVal = document.getElementById('width-val');
const targetDiagonalVal = document.getElementById('target-diagonal-val');
const diagonalVal = document.getElementById('diagonal-val');
const statusMsg = document.getElementById('status-msg');
const toiletRect = document.getElementById('toilet-rect');
const diagonalLine = document.getElementById('diagonal-line');
const catLayer = document.getElementById('cat-layer');

const copyPermalinkBtn = document.getElementById('copy-permalink');

const DIAGONAL_MULTIPLIER = 1.5;
const SCALE_CM = 5; // 1cm = 5px
const OFFSET = 50; // SVG offset
const CAT_BASE_LENGTH = 65; // The length of the silhouette path in its local coordinates (nose to tail base)
const CM_TO_IN = 1 / 2.54;
const IN_TO_CM = 2.54;

let currentUnit = 'cm';

// Default values in CM
const DEFAULTS = {
    catSize: 50,
    length: 50,
    width: 50
};

// Ranges in CM
const RANGES = {
    catSize: { min: 20, max: 80 },
    length: { min: 30, max: 100 },
    width: { min: 30, max: 100 }
};

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('unit')) {
        const unit = params.get('unit').toLowerCase();
        if (unit === 'cm' || unit === 'in') {
            currentUnit = unit;
            document.querySelector(`input[name="unit"][value="${currentUnit}"]`).checked = true;
        }
    }

    const isMetric = currentUnit === 'cm';
    const factor = isMetric ? 1 : CM_TO_IN;

    // Apply defaults or URL params
    const setState = (id, paramKey, defaultValCm) => {
        const input = document.getElementById(id);
        let valCm = defaultValCm;
        if (params.has(paramKey)) {
            const paramVal = parseFloat(params.get(paramKey));
            valCm = isMetric ? paramVal : paramVal * IN_TO_CM;
        }
        input.value = isMetric ? valCm : (valCm * CM_TO_IN).toFixed(1);
    };

    setState('cat-size', 'catSize', DEFAULTS.catSize);
    setState('length', 'length', DEFAULTS.length);
    setState('width', 'width', DEFAULTS.width);
}

function updateUnits(shouldConvert = true) {
    const isMetric = currentUnit === 'cm';
    const unitText = isMetric ? 'cm' : 'in';
    const factor = isMetric ? 1 : CM_TO_IN;

    // Update labels text
    catSizeLabel.innerHTML = `Cat Size (nose to base of tail, ${unitText}): <span id="cat-size-val"></span>`;
    lengthLabel.innerHTML = `Length (${unitText}): <span id="length-val"></span>`;
    widthLabel.innerHTML = `Width (${unitText}): <span id="width-val"></span>`;

    // Update slider ranges and optionally convert values
    const inputs = [
        { input: catSizeInput, range: RANGES.catSize },
        { input: lengthInput, range: RANGES.length },
        { input: widthInput, range: RANGES.width }
    ];

    inputs.forEach(({ input, range }) => {
        if (shouldConvert) {
            const currentVal = parseFloat(input.value);
            if (isMetric) {
                input.value = Math.round(currentVal * IN_TO_CM);
            } else {
                input.value = (currentVal * CM_TO_IN).toFixed(1);
            }
        }
        
        input.min = (range.min * factor).toFixed(1);
        input.max = (range.max * factor).toFixed(1);
        input.step = isMetric ? 1 : 0.5;
    });

    update();
}

function update() {
    const isMetric = currentUnit === 'cm';
    const unitText = isMetric ? 'cm' : 'in';
    
    // Values from inputs (already in current unit)
    const catSize = parseFloat(catSizeInput.value);
    const length = parseFloat(lengthInput.value);
    const width = parseFloat(widthInput.value);
    
    // Convert to CM for consistent SVG scaling
    const catSizeCm = isMetric ? catSize : catSize * IN_TO_CM;
    const lengthCm = isMetric ? length : length * IN_TO_CM;
    const widthCm = isMetric ? width : width * IN_TO_CM;

    const targetDiagonal = catSize * DIAGONAL_MULTIPLIER;
    
    // Update labels
    document.getElementById('cat-size-val').textContent = catSize;
    document.getElementById('length-val').textContent = length;
    document.getElementById('width-val').textContent = width;
    targetDiagonalVal.textContent = targetDiagonal.toFixed(1) + ' ' + unitText;
    
    // Calculate diagonal
    const diagonal = Math.sqrt(length ** 2 + width ** 2);
    diagonalVal.textContent = diagonal.toFixed(1) + ' ' + unitText;
    
    // Update status
    if (diagonal >= targetDiagonal) {
        statusMsg.textContent = "Perfect! Large enough.";
        statusMsg.className = "status-msg success";
        diagonalLine.setAttribute('stroke', '#2ecc71');
    } else {
        statusMsg.textContent = "Too small!";
        statusMsg.className = "status-msg alert";
        diagonalLine.setAttribute('stroke', '#e74c3c');
    }
    
    // Update SVG Toilet
    const svgLength = lengthCm * SCALE_CM;
    const svgWidth = widthCm * SCALE_CM;
    
    toiletRect.setAttribute('width', svgLength);
    toiletRect.setAttribute('height', svgWidth);
    
    diagonalLine.setAttribute('x2', OFFSET + svgLength);
    diagonalLine.setAttribute('y2', OFFSET + svgWidth);

    // Update Cat Visualization
    const catPx = catSizeCm * SCALE_CM;
    const scaleFactor = catPx / CAT_BASE_LENGTH;
    const angleRad = Math.atan2(svgWidth, svgLength);
    const angleDeg = angleRad * (180 / Math.PI);

    // Center of the diagonal
    const centerX = OFFSET + svgLength / 2;
    const centerY = OFFSET + svgWidth / 2;

    catLayer.setAttribute('transform', `translate(${centerX}, ${centerY}) rotate(${angleDeg}) scale(${scaleFactor})`);
}

function copyPermalink() {
    const params = new URLSearchParams();
    params.set('unit', currentUnit);
    params.set('catSize', catSizeInput.value);
    params.set('length', lengthInput.value);
    params.set('width', widthInput.value);

    const url = window.location.origin + window.location.pathname + '?' + params.toString();
    
    navigator.clipboard.writeText(url).then(() => {
        const originalText = copyPermalinkBtn.textContent;
        copyPermalinkBtn.textContent = 'Copied!';
        copyPermalinkBtn.classList.add('copied');
        setTimeout(() => {
            copyPermalinkBtn.textContent = originalText;
            copyPermalinkBtn.classList.remove('copied');
        }, 2000);
    });
}

unitInputs.forEach(input => {
    input.addEventListener('change', (e) => {
        currentUnit = e.target.value;
        updateUnits(true);
    });
});

catSizeInput.addEventListener('input', update);
lengthInput.addEventListener('input', update);
widthInput.addEventListener('input', update);
copyPermalinkBtn.addEventListener('click', copyPermalink);

// Initial setup
loadStateFromURL();
updateUnits(false);
