// =========================================================================
// CẤU HÌNH HỆ THỐNG RADISSON COLLECTION HA LONG BAY
// =========================================================================
const CONFIG = {
    DATA_FILE: 'data.csv',
    DEFAULT_3D_IMAGE: 'images/toa1.jpg',
    DEFAULT_BASE_FLOOR: '7',
    PHYSICAL_FLOORS: [
        '7', '8', '9', '10', '11', '12', '12A', '12B',
        '15', '16', '17', '18',
        '19A', '19B', '20', '20B', '21',
        '22', '23', '24', '25', '26', '27'
    ],
    URL_360_THUC_TE: 'https://tour.panoee.net/RadissonCollectionHLB',
    URL_360_DIEN_HOA: 'https://radisson-virtualtour-viewer.vercel.app/',
    IS_360_DIEN_HOA_PUBLIC: false // Đổi thành true khi muốn mở link 360 diễn họa
};

let apartmentData = [];
let hiddenPaymentsState = {};
let activeHighlightedSvgEl = null;

// =========================================================================
// 1. TẢI VÀ PHÂN TÍCH DỮ LIỆU CSV (KHÔNG TỰ ĐỘNG HIỆN CĂN NÀO KHI MỚI VÀO WEB)
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
    setupSearchInputEvents();
    setupLightboxEvents();
    initSourceProtection();

    fetch(`${CONFIG.DATA_FILE}?v=${Date.now()}`)
        .then(res => {
            if (!res.ok) throw new Error('Không tìm thấy tệp data.csv');
            return res.text();
        })
        .then(csvText => {
            apartmentData = parseCSVStandard(csvText);

            const toast = document.getElementById('statusToast');
            if (toast) {
                toast.innerText = `Sẵn sàng (${apartmentData.length} căn)`;
                setTimeout(() => { toast.style.display = 'none'; }, 2200);
            }
        })
        .catch(() => {
            const toast = document.getElementById('statusToast');
            if (toast) {
                toast.innerText = 'Lỗi nạp tệp data.csv';
                toast.style.background = 'rgba(217, 38, 38, 0.85)';
            }
        });
});

// Tự động căn lại nhãn mã căn trên SVG khi thay đổi kích thước cửa sổ
window.addEventListener('resize', () => {
    if (activeHighlightedSvgEl) {
        positionSvgCallout(activeHighlightedSvgEl);
    }
});

// Bộ đọc CSV chuẩn RFC-4180
function parseCSVStandard(text) {
    const cleanText = text.replace(/^\uFEFF/, '');
    const firstLine = cleanText.split(/\r?\n/)[0] || '';
    const delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

    const rows = [];
    let currentRow = [];
    let currentVal = '';
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
        const char = cleanText[i];
        const nextChar = cleanText[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentVal += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            currentRow.push(currentVal.trim());
            currentVal = '';
        } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
            if (char === '\r') i++;
            currentRow.push(currentVal.trim());
            if (currentRow.some(cell => cell !== '')) rows.push(currentRow);
            currentRow = [];
            currentVal = '';
        } else {
            currentVal += char;
        }
    }

    if (currentVal !== '' || currentRow.length > 0) {
        currentRow.push(currentVal.trim());
        if (currentRow.some(cell => cell !== '')) rows.push(currentRow);
    }

    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().trim());
    return rows.slice(1).map(cols => {
        const obj = { _rawHeaders: rows[0] };
        headers.forEach((h, idx) => {
            obj[h] = cols[idx] !== undefined ? cols[idx].trim() : '';
        });
        return obj;
    });
}

// =========================================================================
// 2. HÀM TIỆN ÍCH DỮ LIỆU, DỊCH HƯỚNG & CHUẨN HÓA MÃ CĂN R.TẦNG.CĂN
// =========================================================================
function getCol(row, possibleKeys) {
    if (!row) return '';
    const keys = Object.keys(row);
    for (const target of possibleKeys) {
        const exact = keys.find(k => k === target.toLowerCase());
        if (exact && row[exact] !== undefined) return row[exact];
    }
    for (const target of possibleKeys) {
        const partial = keys.find(k => k.includes(target.toLowerCase()));
        if (partial && row[partial] !== undefined) return row[partial];
    }
    return '';
}

function isValidValue(val) {
    if (val === null || val === undefined) return false;
    const s = String(val).trim();
    return s !== '' && s !== '-' && s !== '---' && s.toLowerCase() !== 'n/a' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'nan';
}

function translateDirection(rawDir) {
    if (!isValidValue(rawDir)) return '';
    const charMap = {
        'Đ': 'Đông',
        'T': 'Tây',
        'N': 'Nam',
        'B': 'Bắc'
    };

    return String(rawDir)
        .split(/(\s*[-/,&]\s*)/)
        .map(part => {
            const trimmed = part.trim();
            if (!trimmed || /^[-/,&]$/.test(trimmed)) return part;

            const upper = trimmed.toUpperCase();
            if (/^[ĐTNB]{1,2}$/.test(upper)) {
                return upper.split('').map(ch => charMap[ch] || ch).join(' ');
            }
            return trimmed;
        })
        .join('');
}

function formatPrice(rawVal) {
    if (!isValidValue(rawVal)) return '';
    const str = String(rawVal).trim();
    const digitsOnly = str.replace(/[.,\s]/g, '');
    if (/^\d+$/.test(digitsOnly)) {
        return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    return str;
}

// Chuẩn hóa từng phần Tầng hoặc Căn (ví dụ: '7' -> '07', '12A' -> '12A', '3A' -> '03A', '06A' -> '06A')
function padUnitSegment(seg) {
    const clean = String(seg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = clean.match(/^(\d+)([A-Z]*)$/);
    if (!m) return clean;
    const numPart = m[1].length === 1 ? '0' + m[1] : m[1];
    return `${numPart}${m[2]}`;
}

// Chuẩn hóa hoàn chỉnh mã căn về định dạng R.Tầng.Căn (hỗ trợ cả tầng 2 số, 3 số + chữ như 12A, 12B, 102A và căn 03A, 12A...)
function normalizeUnitCode(input) {
    let clean = String(input || '').trim().toUpperCase().replace(/[-_,\s]+/g, '.');
    if (!clean) return '';

    // Nếu người dùng đã nhập có dấu chấm phân tách (ví dụ: r.7.3a, 12a.1, r.12b.03a, 102a.5)
    if (clean.includes('.')) {
        let parts = clean.split('.').filter(Boolean);
        if (parts[0] === 'R') {
            parts.shift();
        } else if (parts[0].startsWith('R') && parts[0].length > 1) {
            parts[0] = parts[0].slice(1);
        }

        if (parts.length >= 2) {
            const floor = padUnitSegment(parts[0]);
            const unit = padUnitSegment(parts[1]);
            return `R.${floor}.${unit}`;
        }
        if (parts.length === 1) {
            return `R.${padUnitSegment(parts[0])}`;
        }
    }

    // Nếu người dùng nhập liền không dấu chấm (ví dụ: 71, 0701, r0703a, 12a01, 12b3a, 1212a, 102a05)
    const compact = clean.replace(/^R/, '');

    // Tách tất cả các cụm [Số + Chữ cái tùy chọn]
    const tokens = compact.match(/\d+[A-Z]?/g);
    if (tokens && tokens.length >= 2) {
        // Trường hợp có chữ ở giữa giúp tách tự nhiên (VD: 12A01 -> ['12A', '01'], 12B3A -> ['12B', '3A'], 102A05 -> ['102A', '05'])
        const floor = padUnitSegment(tokens[0]);
        const unit = padUnitSegment(tokens[1]);
        return `R.${floor}.${unit}`;
    }

    // Trường hợp toàn số hoặc chỉ có chữ ở cuối (VD: 71, 701, 0701, 1213, 703A, 0703A, 1212A, 10212)
    const singleMatch = compact.match(/^(\d+)([A-Z]?)$/);
    if (singleMatch) {
        const digits = singleMatch[1];
        const suffixLetter = singleMatch[2];

        if (digits.length === 2) {
            // VD: 71 -> R.07.01
            return `R.0${digits[0]}.0${digits[1]}${suffixLetter}`;
        }
        if (digits.length === 3) {
            // VD: 701 -> R.07.01 | 73A -> R.07.03A
            if (digits.startsWith('0')) {
                return `R.${digits.slice(0, 2)}.0${digits.slice(2)}${suffixLetter}`;
            }
            return `R.0${digits[0]}.${digits.slice(1)}${suffixLetter}`;
        }
        if (digits.length === 4) {
            // VD: 0701 -> R.07.01 | 1213 -> R.12.13 | 1212A -> R.12.12A
            return `R.${digits.slice(0, 2)}.${digits.slice(2)}${suffixLetter}`;
        }
        if (digits.length >= 5) {
            // VD tầng 3 số: 10205 -> R.102.05
            return `R.${digits.slice(0, 3)}.${padUnitSegment(digits.slice(3))}${suffixLetter}`;
        }
    }

    return clean.startsWith('R.') ? clean : (clean.startsWith('R') ? 'R.' + clean.slice(1) : 'R.' + clean);
}

// Tự động định dạng R.Tầng.Căn ngay trong lúc gõ trên thanh tìm kiếm
function formatSearchInputLive(rawValue) {
    let val = String(rawValue || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!val) return '';

    // Luôn bắt đầu bằng R.
    if (val === 'R') return 'R.';
    if (!val.startsWith('R')) {
        val = 'R.' + val;
    } else if (val.length >= 2 && val[1] !== '.') {
        val = 'R.' + val.slice(1);
    }

    // Xử lý phần sau "R."
    let rest = val.slice(2).replace(/\.+/g, '.');
    if (!rest) return 'R.';

    // Nếu người dùng đã gõ dấu chấm thứ 2 (VD: R.12A.01 hoặc R.07.03A)
    if (rest.includes('.')) {
        const dotIdx = rest.indexOf('.');
        const floorPart = rest.slice(0, dotIdx).replace(/\./g, '');
        const unitPart = rest.slice(dotIdx + 1).replace(/\./g, '');
        return `R.${floorPart}.${unitPart}`;
    }

    // Tự động chèn dấu chấm thứ 2 khi kết thúc cụm Tầng:
    // 1. Tầng có chữ đi kèm như 12A, 12B, 19A, 20B, 102A và người dùng gõ tiếp ký tự căn
    const alphaFloorMatch = rest.match(/^(\d{1,3}[A-Z])(.+)$/);
    if (alphaFloorMatch) {
        return `R.${alphaFloorMatch[1]}.${alphaFloorMatch[2]}`;
    }

    // 2. Tầng bắt đầu bằng 0 (07, 08, 09) và người dùng gõ sang ký tự thứ 3 (VD: R.070 -> R.07.0)
    if (/^0\d{2}/.test(rest)) {
        return `R.${rest.slice(0, 2)}.${rest.slice(2)}`;
    }

    // 3. Tầng 2 chữ số (10..27) và người dùng gõ đủ 4 chữ số (VD: R.1213 -> R.12.13, R.1212A -> R.12.12A)
    if (/^[1-9]\d{3,}/.test(rest)) {
        return `R.${rest.slice(0, 2)}.${rest.slice(2)}`;
    }

    return `R.${rest}`;
}

// =========================================================================
// 3. TRA CỨU & HIỂN THỊ CĂN HỘ
// =========================================================================
function setupSearchInputEvents() {
    const inputEl = document.getElementById('searchInput');
    if (!inputEl) return;

    inputEl.addEventListener('input', e => {
        // Không ép định dạng khi người dùng đang bấm phím Xóa (Backspace/Delete)
        if (e.inputType && e.inputType.startsWith('delete')) return;
        const formatted = formatSearchInputLive(inputEl.value);
        if (formatted !== inputEl.value) {
            inputEl.value = formatted;
        }
    });

    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchApartment();
        }
    });

    inputEl.addEventListener('blur', () => {
        const val = inputEl.value.trim();
        if (!val || val === 'R.') {
            inputEl.value = '';
            return;
        }
        inputEl.value = normalizeUnitCode(val);
    });
}

function searchApartment() {
    if (apartmentData.length === 0) {
        alert('Dữ liệu đang được tải, vui lòng đợi trong giây lát!');
        return;
    }

    const inputEl = document.getElementById('searchInput');
    const rawQuery = inputEl.value.trim();
    if (!rawQuery || rawQuery === 'R.') return;

    const normalizedQuery = normalizeUnitCode(rawQuery);
    inputEl.value = normalizedQuery;

    const matchedRow = apartmentData.find(row => {
        const rowCode = normalizeUnitCode(getCol(row, ['mã căn hộ', 'mã căn']));
        return rowCode === normalizedQuery;
    });

    if (!matchedRow) {
        alert(`Không tìm thấy mã căn "${normalizedQuery}" trong dữ liệu dự án!`);
        return;
    }

    inputEl.value = getCol(matchedRow, ['mã căn hộ', 'mã căn']) || normalizedQuery;
    renderApartment(matchedRow);
}

function renderApartment(row) {
    // Mở giao diện chi tiết và nút Tải xuống ảnh khi đã tìm kiếm căn hộ
    const mainCard = document.getElementById('exportContainer');
    if (mainCard) mainCard.classList.remove('is-empty-state');

    const btnExport = document.getElementById('btnExport');
    if (btnExport) btnExport.style.display = 'inline-flex';

    const unitCode = getCol(row, ['mã căn hộ', 'mã căn']) || '---';
    const productType = getCol(row, ['loại hình sản phẩm', 'loại hình']);
    const productLine = getCol(row, ['dòng sản phẩm']);
    const direction = translateDirection(getCol(row, ['hướng']));
    const areaNet = getCol(row, ['tổng diện tích thông thuỷ', 'tổng diện tích thông thủy', 'diện tích thông thủy']);
    const areaGross = getCol(row, ['tổng diện tích tim tường', 'diện tích tim tường']);
    const areaBalcony = getCol(row, ['diện tích ban công']);
    const ceilingPrice = formatPrice(getCol(row, ['giá trần', 'giá bán']));

    // 1. Cập nhật mã căn động
    document.getElementById('lblMaCanTop').innerText = unitCode;
    document.getElementById('lblMaCan3D').innerText = unitCode;
    document.getElementById('lblMaCanSvg').innerText = unitCode;

    // 2. Render 2 dòng tóm tắt dưới Mã căn
    const topMetaEl = document.getElementById('topMetaContainer');
    const topMetaItems = [
        { label: 'Loại hình sản phẩm:', value: productType },
        { label: 'Dòng sản phẩm:', value: productLine }
    ].filter(item => isValidValue(item.value));

    topMetaEl.innerHTML = topMetaItems.map(item => `
        <div class="top-meta-row">
            <span>${item.label}</span>
            <strong>${item.value}</strong>
        </div>
    `).join('');

    // 3. Render bảng thông số chi tiết bên phải
    const specsListEl = document.getElementById('infoSpecsList');
    const specItems = [
        { label: 'Loại hình sản phẩm:', value: productType },
        { label: 'Dòng sản phẩm:', value: productLine },
        { label: 'Hướng:', value: direction },
        { label: 'Tổng diện tích thông thủy:', value: isValidValue(areaNet) ? `${areaNet}m²` : '' },
        { label: 'Tổng diện tích tim tường:', value: isValidValue(areaGross) ? `${areaGross}m²` : '' },
        { label: 'Diện tích ban công:', value: isValidValue(areaBalcony) ? `${areaBalcony}m²` : '' },
        { label: 'Giá trần:', value: ceilingPrice }
    ].filter(item => isValidValue(item.value));

    specsListEl.innerHTML = specItems.map(item => `
        <div class="spec-row">
            <span class="spec-label">${item.label}</span>
            <strong class="spec-value">${item.value}</strong>
        </div>
    `).join('');

    // 4. Render Bảng giá theo PTTT (Tự động ẩn nếu không có data)
    renderPaymentPlans(row);

    // 5. Cập nhật ảnh 3D tòa nhà & điểm định vị
    update3DBuildingMarker(row, unitCode);

    // 6. Nạp & đánh dấu mặt bằng SVG tầng từ thư mục svg/
    updateFloorPlanSVG(row, unitCode);

    // 7. Cập nhật Layout & Diễn họa nội thất từ thư mục images/
    updateMediaCards(row);
}

// =========================================================================
// 4. BẢNG GIÁ THEO PHƯƠNG ÁN THANH TOÁN (NÚT + VÀ - CỐ ĐỊNH CÙNG VỊ TRÍ)
// =========================================================================
function renderPaymentPlans(row) {
    const paymentListEl = document.getElementById('paymentList');
    const paymentCardEl = document.getElementById('paymentCard');
    const middleGridEl = document.getElementById('middleInfoGrid');

    const early95Header = (row._rawHeaders || []).find(h =>
        h.toLowerCase().includes('thanh toán sớm 95') || h.toLowerCase().includes('thanh toán sớm 75')
    ) || 'Thanh toán sớm 95%';

    const plans = [
        { key: 'tien_do', label: 'Thanh toán tiến độ', value: formatPrice(getCol(row, ['thanh toán theo tiến độ', 'thanh toán tiến độ'])) },
        { key: 'vay_nh', label: 'Vay ngân hàng', value: formatPrice(getCol(row, ['vay ngân hàng'])) },
        { key: 'tts_30', label: 'Thanh toán sớm 30%', value: formatPrice(getCol(row, ['thanh toán sớm 30%'])) },
        { key: 'tts_50', label: 'Thanh toán sớm 50%', value: formatPrice(getCol(row, ['thanh toán sớm 50%'])) },
        { key: 'tts_95', label: early95Header, value: formatPrice(getCol(row, ['thanh toán sớm 95%', 'thanh toán sớm 75%'])) }
    ].filter(p => isValidValue(p.value));

    if (plans.length === 0) {
        paymentCardEl.style.display = 'none';
        paymentListEl.innerHTML = '';
        if (middleGridEl) middleGridEl.classList.add('no-payment-card');
        return;
    }

    if (middleGridEl) middleGridEl.classList.remove('no-payment-card');
    paymentCardEl.style.display = 'block';
    paymentListEl.innerHTML = plans.map(plan => {
        const isHidden = Boolean(hiddenPaymentsState[plan.key]);
        return `
            <div class="payment-row ${isHidden ? 'is-hidden' : ''}" data-plan-key="${plan.key}">
                <span class="payment-name">${plan.label}</span>
                <div class="payment-pill-wrap">
                    <span class="payment-price-pill">${plan.value}</span>
                    <button type="button"
                            class="btn-toggle-price"
                            onclick="togglePaymentVisibility('${plan.key}')"
                            title="${isHidden ? 'Hiện mức giá này' : 'Ẩn mức giá này'}">
                        ${isHidden ? '+' : '−'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function togglePaymentVisibility(planKey) {
    hiddenPaymentsState[planKey] = !hiddenPaymentsState[planKey];
    const rowEl = document.querySelector(`.payment-row[data-plan-key="${planKey}"]`);
    if (!rowEl) return;

    const btn = rowEl.querySelector('.btn-toggle-price');
    const isHidden = hiddenPaymentsState[planKey];

    rowEl.classList.toggle('is-hidden', isHidden);
    if (btn) {
        btn.innerText = isHidden ? '+' : '−';
        btn.title = isHidden ? 'Hiện mức giá này' : 'Ẩn mức giá này';
    }
}

// =========================================================================
// 5. ĐỊNH VỊ ĐIỂM CHẤM TRÊN ẢNH PHỐI CẢNH 3D TÒA NHÀ (images/toa1.jpg | toa2.jpg)
// =========================================================================
function update3DBuildingMarker(row, unitCode) {
    const img3D = document.getElementById('img3D');
    const ph3D = document.getElementById('placeholder3D');
    const marker = document.getElementById('marker3DWrapper');

    const custom3D = getCol(row, ['ảnh 3d', 'anh 3d']);
    const imgSrc = isValidValue(custom3D) ? resolveImagePath(custom3D, 'jpg') : CONFIG.DEFAULT_3D_IMAGE;

    delete img3D.dataset.triedPng;
    delete img3D.dataset.triedJpg;
    img3D.style.display = 'block';
    ph3D.style.display = 'none';
    if (img3D.getAttribute('src') !== imgSrc) {
        img3D.src = imgSrc;
    }

    const rawX = getCol(row, ['tọa độ x', 'toạ độ x']);
    const rawY = getCol(row, ['tọa độ y', 'toạ độ y']);
    const rawStep = getCol(row, ['bước nhảy']);

    const posX = parseFloat(String(rawX).replace(',', '.'));
    const yStr = String(rawY || '').trim();
    const baseY = parseFloat(yStr.replace(',', '.'));
    const stepY = parseFloat(String(rawStep || '0').replace(',', '.')) || 0;

    if (isNaN(posX) || isNaN(baseY)) {
        marker.style.display = 'none';
        return;
    }

    let finalY = baseY;

    if (stepY !== 0) {
        let currentFloor = getCol(row, ['tầng']).toUpperCase().replace(/^0+/, '');
        if (!isValidValue(currentFloor)) {
            const parts = unitCode.split('.');
            if (parts.length >= 2) currentFloor = parts[1].toUpperCase().replace(/^0+/, '');
        }

        let baseFloor = CONFIG.DEFAULT_BASE_FLOOR.toUpperCase().replace(/^0+/, '');
        const floorNoteMatch = yStr.match(/tầng\s*([0-9]+[A-Z]?)/i);
        if (floorNoteMatch) {
            baseFloor = floorNoteMatch[1].toUpperCase().replace(/^0+/, '');
        }

        const idxCurrent = CONFIG.PHYSICAL_FLOORS.indexOf(currentFloor);
        const idxBase = CONFIG.PHYSICAL_FLOORS.indexOf(baseFloor);

        if (idxCurrent !== -1 && idxBase !== -1) {
            const floorSteps = idxCurrent - idxBase;
            finalY = baseY - (floorSteps * stepY);
        } else {
            const numDiff = (parseFloat(currentFloor) || 0) - (parseFloat(baseFloor) || 0);
            finalY = baseY - (numDiff * stepY);
        }
    }

    marker.style.left = `${posX}%`;
    marker.style.top = `${finalY}%`;
    marker.classList.toggle('flip-left', posX > 72);
    marker.style.display = 'flex';
}

// =========================================================================
// 6. NẠP & ĐÁNH DẤU MẶT BẰNG TẦNG SVG (GIẢI MÃ CHUẨN ID ILLUSTRATOR _x0030_1 -> 01)
// =========================================================================
function decodeIllustratorId(rawStr) {
    if (!rawStr) return '';
    // Giải mã các ký tự số/ký hiệu do Illustrator xuất ra XML ID (VD: _x0030_1 -> 01, _x0031_2A -> 12A)
    let decoded = String(rawStr).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    );
    // Loại bỏ hậu tố trùng lặp nếu có (_1_, _2_...) và dấu gạch dưới đầu
    decoded = decoded.replace(/_\d+_$/, '').replace(/^_+/, '');
    return decoded.trim().toUpperCase();
}

// Chuẩn hóa về dạng có số 0 đứng trước 2 chữ số (VD: '1' -> '01', '3A' -> '03A', '06A' -> '06A', '12A' -> '12A')
function normalizePaddedAxis(rawAxis) {
    const decoded = decodeIllustratorId(rawAxis).replace(/[^A-Z0-9]/g, '');
    const match = decoded.match(/^0*(\d+)([A-Z]?)$/);
    if (match) {
        const num = parseInt(match[1], 10);
        const padded = num < 10 ? `0${num}` : `${num}`;
        return `${padded}${match[2]}`;
    }
    return decoded;
}

function clearSvgUnitStyle(el) {
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('fill', 'transparent', 'important');
    el.style.setProperty('stroke', 'transparent', 'important');
    el.style.removeProperty('mix-blend-mode');
    el.querySelectorAll('polygon, path, rect, polyline, circle').forEach(child => {
        child.style.setProperty('opacity', '0', 'important');
        child.style.setProperty('fill', 'transparent', 'important');
        child.style.setProperty('stroke', 'transparent', 'important');
        child.style.removeProperty('mix-blend-mode');
    });
}

function highlightSvgUnitStyle(el) {
    const highlightFill = '#eb4d24';
    const highlightStroke = '#c92a14';

    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('display', 'inline', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('fill', highlightFill, 'important');
    el.style.setProperty('fill-opacity', '0.78', 'important');
    el.style.setProperty('stroke', highlightStroke, 'important');
    el.style.setProperty('stroke-width', '1.5px', 'important');
    el.style.setProperty('mix-blend-mode', 'multiply', 'important');

    el.querySelectorAll('polygon, path, rect, polyline, circle').forEach(child => {
        child.style.setProperty('opacity', '1', 'important');
        child.style.setProperty('display', 'inline', 'important');
        child.style.setProperty('visibility', 'visible', 'important');
        child.style.setProperty('fill', highlightFill, 'important');
        child.style.setProperty('fill-opacity', '0.78', 'important');
        child.style.setProperty('stroke', highlightStroke, 'important');
        child.style.setProperty('stroke-width', '1.5px', 'important');
        child.style.setProperty('mix-blend-mode', 'multiply', 'important');
    });
}

function updateFloorPlanSVG(row, unitCode) {
    const svgContainer = document.getElementById('svgContainer');
    const badge = document.getElementById('svgCalloutBadge');
    badge.style.display = 'none';
    activeHighlightedSvgEl = null;

    const svgFileRaw = getCol(row, ['mặt bằng svg', 'mat bang svg', 'svg']);
    if (!isValidValue(svgFileRaw)) {
        svgContainer.innerHTML = '<div class="image-placeholder">Chưa khai báo tệp mặt bằng SVG cho tầng này</div>';
        return;
    }

    const svgFileName = svgFileRaw.toLowerCase().endsWith('.svg') ? svgFileRaw : `${svgFileRaw}.svg`;

    fetch(`svg/${svgFileName}?v=${Date.now()}`)
        .then(res => {
            if (!res.ok) throw new Error(`Không tìm thấy svg/${svgFileName}`);
            return res.text();
        })
        .then(svgMarkup => {
            svgContainer.innerHTML = svgMarkup;
            const svgEl = svgContainer.querySelector('svg');
            if (!svgEl) return;

            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.width = '100%';
            svgEl.style.height = '100%';
            svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            // Lấy STT căn từ CSV (VD: 1 -> 01, 3A -> 03A) và dự phòng mã đuôi từ Mã căn hộ (VD: R.12B.03A -> 03A)
            const sttRaw = getCol(row, ['stt căn', 'stt']);
            const codeParts = unitCode.split('.');
            const codeSuffixRaw = codeParts.length >= 3 ? codeParts[2] : '';

            const targetFromStt = isValidValue(sttRaw) ? normalizePaddedAxis(sttRaw) : '';
            const targetFromCode = isValidValue(codeSuffixRaw) ? normalizePaddedAxis(codeSuffixRaw) : '';

            // Thu thập toàn bộ phần tử vector vùng căn (bỏ qua Layer_1 và nhóm nền bg)
            const unitCandidates = [];
            const allElements = svgEl.querySelectorAll('g, polygon, path, rect, polyline');

            allElements.forEach(el => {
                if (el.closest('#bg') || el.closest('#BG') || el.closest('defs')) return;

                const rawIdentifier = el.getAttribute('id') || el.getAttribute('data-name') || el.getAttribute('inkscape:label') || '';
                if (!rawIdentifier) return;

                const decoded = decodeIllustratorId(rawIdentifier);
                if (!decoded || decoded === 'LAYER_1' || decoded === 'LAYER1' || decoded === 'BG') return;

                // Khớp tên poly: 01, 02, 03A, 06A, 12A, 12B, 15... (hoặc CAN_01, R.07.01)
                const isDirectAxis = /^\d{1,2}[A-Z]?$/.test(decoded);
                const isCanPrefixed = /^CAN[_\-.]?\d{1,2}[A-Z]?$/.test(decoded);
                const isFullUnit = /^R[.\-_]?\d{1,2}[A-Z]?[.\-_]?\d{1,2}[A-Z]?$/.test(decoded);

                if (isDirectAxis || isCanPrefixed || isFullUnit) {
                    let axisToken = '';
                    if (isDirectAxis) {
                        axisToken = normalizePaddedAxis(decoded);
                    } else if (isCanPrefixed) {
                        axisToken = normalizePaddedAxis(decoded.replace(/^CAN[_\-.]?/, ''));
                    } else if (isFullUnit) {
                        const m = decoded.match(/^R[.\-_]?\d{1,2}[A-Z]?[.\-_]?(\d{1,2}[A-Z]?)$/);
                        axisToken = m ? normalizePaddedAxis(m[1]) : '';
                    }

                    if (axisToken) {
                        clearSvgUnitStyle(el);
                        unitCandidates.push({ el, axisToken });
                    }
                }
            });

            // Ưu tiên khớp theo STT căn (đã bù số 0: 1 -> 01, 3A -> 03A), nếu không thấy thì khớp theo đuôi Mã căn hộ
            let matched = null;
            if (targetFromStt) {
                matched = unitCandidates.find(item => item.axisToken === targetFromStt);
            }
            if (!matched && targetFromCode) {
                matched = unitCandidates.find(item => item.axisToken === targetFromCode);
            }

            if (matched && matched.el) {
                highlightSvgUnitStyle(matched.el);
                activeHighlightedSvgEl = matched.el;
                requestAnimationFrame(() => positionSvgCallout(matched.el));
                setTimeout(() => positionSvgCallout(matched.el), 120);
            }
        })
        .catch(() => {
            svgContainer.innerHTML = `<div class="image-placeholder">Không tải được mặt bằng (${svgFileName})</div>`;
        });
}

function positionSvgCallout(targetEl) {
    const box = document.getElementById('floorplanBox');
    const badge = document.getElementById('svgCalloutBadge');
    if (!box || !badge || !targetEl) return;

    const boxRect = box.getBoundingClientRect();
    let targetRect = targetEl.getBoundingClientRect();

    if (targetRect.width === 0 && targetEl.children.length > 0) {
        targetRect = targetEl.children[0].getBoundingClientRect();
    }

    if (targetRect.width > 0) {
        const centerX = (targetRect.left + targetRect.width / 2) - boxRect.left;
        const topY = targetRect.top - boxRect.top;

        badge.style.left = `${centerX}px`;
        badge.style.top = `${Math.max(22, topY)}px`;
        badge.style.display = 'block';
    }
}

// =========================================================================
// 7. CẬP NHẬT ẢNH LAYOUT & DIỄN HỌA NỘI THẤT (FOLDER images/)
// =========================================================================
function resolveImagePath(fileName, defaultExt) {
    const clean = String(fileName).trim();
    if (/\.(png|jpg|jpeg|webp|svg)$/i.test(clean)) {
        return `images/${clean}`;
    }
    return `images/${clean}.${defaultExt}`;
}

function handleImageFallback(imgEl, type) {
    const currentSrc = imgEl.getAttribute('src') || '';
    if (currentSrc.endsWith('.jpg') && !imgEl.dataset.triedPng) {
        imgEl.dataset.triedPng = '1';
        imgEl.src = currentSrc.replace(/\.jpg$/i, '.png');
        return;
    }
    if (currentSrc.endsWith('.png') && !imgEl.dataset.triedJpg) {
        imgEl.dataset.triedJpg = '1';
        imgEl.src = currentSrc.replace(/\.png$/i, '.jpg');
        return;
    }

    imgEl.style.display = 'none';
    if (type === '3d') document.getElementById('placeholder3D').style.display = 'flex';
    if (type === 'layout') document.getElementById('phLayout').style.display = 'flex';
    if (type === 'interior') document.getElementById('phInterior').style.display = 'flex';
}

function updateMediaCards(row) {
    const layoutRaw = getCol(row, ['layout']);
    const imgLayout = document.getElementById('imgLayout');
    const phLayout = document.getElementById('phLayout');
    delete imgLayout.dataset.triedPng;
    delete imgLayout.dataset.triedJpg;

    if (isValidValue(layoutRaw)) {
        imgLayout.onerror = () => handleImageFallback(imgLayout, 'layout');
        imgLayout.src = resolveImagePath(layoutRaw, 'png');
        imgLayout.style.display = 'block';
        phLayout.style.display = 'none';
    } else {
        imgLayout.style.display = 'none';
        phLayout.style.display = 'flex';
    }

    const interiorRaw = getCol(row, ['diễn họa', 'dien hoa']);
    const imgInterior = document.getElementById('imgInterior');
    const phInterior = document.getElementById('phInterior');
    delete imgInterior.dataset.triedPng;
    delete imgInterior.dataset.triedJpg;

    if (isValidValue(interiorRaw)) {
        imgInterior.onerror = () => handleImageFallback(imgInterior, 'interior');
        imgInterior.src = resolveImagePath(interiorRaw, 'jpg');
        imgInterior.style.display = 'block';
        phInterior.style.display = 'none';
    } else {
        imgInterior.style.display = 'none';
        phInterior.style.display = 'flex';
    }
}

// =========================================================================
// 8. XUẤT ẢNH BÁO GIÁ (GIỮ ĐÚNG TRẠNG THÁI ẨN/HIỆN PTTT)
// =========================================================================
function exportImage() {
    const container = document.getElementById('exportContainer');
    const watermark = document.getElementById('watermarkSystem');
    const unitCode = document.getElementById('lblMaCanTop').innerText.trim() || 'BaoGia';

    container.classList.add('exporting-mode');
    watermark.style.display = 'flex';

    html2canvas(container, {
        useCORS: true,
        scale: 2,
        backgroundColor: null
    })
        .then(canvas => {
            const link = document.createElement('a');
            link.download = `Radisson_${unitCode.replace(/\./g, '_')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        })
        .finally(() => {
            watermark.style.display = 'none';
            container.classList.remove('exporting-mode');
        });
}

// =========================================================================
// 9. LIGHTBOX PHÓNG TO & KÉO THẢ LAYOUT NỘI THẤT (DUPLEX)
// =========================================================================
let lbScale = 1;
let lbTranslateX = 0;
let lbTranslateY = 0;
let isLbDragging = false;
let lbStartX = 0;
let lbStartY = 0;

function openImageLightbox(type) {
    const sourceImg = type === 'layout' ? document.getElementById('imgLayout') : document.getElementById('imgInterior');
    if (!sourceImg || sourceImg.style.display === 'none' || !sourceImg.src) return;

    const modal = document.getElementById('imageLightbox');
    const lbImg = document.getElementById('lightboxImg');
    const lbTitle = document.getElementById('lightboxTitle');
    const unitCode = document.getElementById('lblMaCanTop').innerText;

    lbTitle.innerText = type === 'layout'
        ? `Layout nội thất — Căn ${unitCode}`
        : `Diễn họa nội thất — Căn ${unitCode}`;

    lbImg.src = sourceImg.src;
    resetLightboxTransform();
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
    document.getElementById('imageLightbox').classList.remove('is-open');
    document.body.style.overflow = '';
}

function closeLightboxOnBackdrop(e) {
    if (e.target.id === 'imageLightbox') closeImageLightbox();
}

function applyLightboxTransform() {
    const lbImg = document.getElementById('lightboxImg');
    const zoomLabel = document.getElementById('zoomLevelText');
    if (lbImg) {
        lbImg.style.transform = `translate(${lbTranslateX}px, ${lbTranslateY}px) scale(${lbScale})`;
    }
    if (zoomLabel) {
        zoomLabel.innerText = `${Math.round(lbScale * 100)}%`;
    }
}

function adjustLightboxZoom(delta) {
    lbScale = Math.min(Math.max(lbScale + delta, 0.75), 4);
    if (lbScale <= 1) {
        lbTranslateX = 0;
        lbTranslateY = 0;
    }
    applyLightboxTransform();
}

function resetLightboxTransform() {
    lbScale = 1;
    lbTranslateX = 0;
    lbTranslateY = 0;
    applyLightboxTransform();
}

function setupLightboxEvents() {
    const viewport = document.getElementById('lightboxViewport');
    if (!viewport) return;

    viewport.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        adjustLightboxZoom(delta);
    }, { passive: false });

    viewport.addEventListener('mousedown', e => {
        isLbDragging = true;
        lbStartX = e.clientX - lbTranslateX;
        lbStartY = e.clientY - lbTranslateY;
    });

    window.addEventListener('mousemove', e => {
        if (!isLbDragging) return;
        lbTranslateX = e.clientX - lbStartX;
        lbTranslateY = e.clientY - lbStartY;
        applyLightboxTransform();
    });

    window.addEventListener('mouseup', () => {
        isLbDragging = false;
    });

    viewport.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
            isLbDragging = true;
            lbStartX = e.touches[0].clientX - lbTranslateX;
            lbStartY = e.touches[0].clientY - lbTranslateY;
        }
    });

    viewport.addEventListener('touchmove', e => {
        if (isLbDragging && e.touches.length === 1) {
            e.preventDefault();
            lbTranslateX = e.touches[0].clientX - lbStartX;
            lbTranslateY = e.touches[0].clientY - lbStartY;
            applyLightboxTransform();
        }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
        isLbDragging = false;
    });
}

// =========================================================================
// 10. POPUP 360 ĐỘ THỰC TẾ & 360 ĐỘ DIỄN HỌA
// =========================================================================
function open360RealModal() {
    const modal = document.getElementById('modal360Real');
    const iframe = document.getElementById('iframe360Real');
    if (!iframe.src || iframe.src === window.location.href) {
        iframe.src = CONFIG.URL_360_THUC_TE;
    }
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
}

function close360RealModal() {
    document.getElementById('modal360Real').classList.remove('is-open');
    document.body.style.overflow = '';
}

function open360RenderModal() {
    if (CONFIG.IS_360_DIEN_HOA_PUBLIC) {
        window.open(CONFIG.URL_360_DIEN_HOA, '_blank');
        return;
    }
    document.getElementById('modal360Render').classList.add('is-open');
    document.body.style.overflow = 'hidden';
}

function close360RenderModal() {
    document.getElementById('modal360Render').classList.remove('is-open');
    document.body.style.overflow = '';
}

function closeModalOnBackdrop(e, modalId) {
    if (e.target.id === modalId) {
        document.getElementById(modalId).classList.remove('is-open');
        document.body.style.overflow = '';
    }
}

// =========================================================================
// 11. CHẾ ĐỘ BẢO VỆ MÃ NGUỒN (CẤM F12, CẤM COPY, CẤM KIỂM TRA CODE)
// =========================================================================
function initSourceProtection() {
    // 1. Cấm chuột phải
    document.addEventListener('contextmenu', e => {
        e.preventDefault();
        return false;
    }, true);

    // 2. Cấm bôi đen, copy, cắt, kéo thả (ngoại trừ ô nhập mã căn #searchInput)
    ['selectstart', 'copy', 'cut', 'dragstart'].forEach(evtName => {
        document.addEventListener(evtName, e => {
            if (e.target && e.target.id === 'searchInput') return;
            e.preventDefault();
            return false;
        }, true);
    });

    // 3. Cấm toàn bộ phím tắt F12, Inspect, Console, View Source, Save Page, Copy
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeImageLightbox();
            close360RealModal();
            close360RenderModal();
            return;
        }

        const key = (e.key || '').toUpperCase();
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;

        // Cấm F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        // Cấm Ctrl+Shift+I / J / C / K hoặc Cmd+Option+I / J / C / U
        if ((isCtrlOrMeta && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key)) ||
            (e.metaKey && e.altKey && ['I', 'J', 'C', 'U'].includes(key))) {
            e.preventDefault();
            return false;
        }

        // Cấm Ctrl+U (Xem nguồn), Ctrl+S (Lưu trang), Ctrl+P (In trang)
        if (isCtrlOrMeta && ['U', 'S', 'P'].includes(key)) {
            e.preventDefault();
            return false;
        }

        // Cấm Ctrl+C / Ctrl+X / Ctrl+A bên ngoài ô tìm kiếm
        if (isCtrlOrMeta && ['C', 'X', 'A'].includes(key)) {
            if (document.activeElement && document.activeElement.id === 'searchInput') return;
            e.preventDefault();
            return false;
        }
    }, true);

    // 4. Phát hiện mở DevTools qua kích thước cửa sổ trên máy tính & làm sạch Console
    const shield = document.getElementById('devtoolsSecurityShield');
    setInterval(() => {
        try {
            console.clear();
        } catch (_) {}

        if (window.innerWidth >= 900) {
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;
            if (widthDiff > 240 || heightDiff > 240) {
                if (shield) shield.classList.add('is-blocked');
            } else {
                if (shield) shield.classList.remove('is-blocked');
            }
        }
    }, 900);
}
