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
let openForSaleUnits = [];
let hiddenPaymentsState = {};
let activeHighlightedSvgEl = null;
let preloadedLogoDataUrl = null;

// =========================================================================
// 1. TẢI VÀ PHÂN TÍCH DỮ LIỆU CSV
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
    setupSearchInputEvents();
    setupLightboxEvents();
    initSourceProtection();
    preloadWatermarkLogo();

    fetch(`${CONFIG.DATA_FILE}?v=${Date.now()}`)
        .then(res => {
            if (!res.ok) throw new Error('Không tìm thấy tệp data.csv');
            return res.text();
        })
        .then(csvText => {
            apartmentData = parseCSVStandard(csvText);

            // Lọc danh sách quỹ căn mở bán giai đoạn này (các căn có Giá trần hợp lệ)
            openForSaleUnits = apartmentData.filter(row => {
                const ceiling = getCol(row, ['giá trần', 'giá bán']);
                return isValidValue(ceiling);
            });

            const countBadge = document.getElementById('openUnitsCountBadge');
            if (countBadge) {
                countBadge.innerText = openForSaleUnits.length;
            }

            populateInventoryFilters();
            renderInventoryTable(openForSaleUnits);

            const toast = document.getElementById('statusToast');
            if (toast) {
                toast.innerText = `Sẵn sàng (${openForSaleUnits.length} căn mở bán / ${apartmentData.length} căn)`;
                setTimeout(() => { toast.style.display = 'none'; }, 2800);
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

// Chuyển sẵn images/logo.svg sang PNG Data URL để html2canvas luôn hiển thị đầy đủ logo watermark
function preloadWatermarkLogo() {
    fetch('images/logo.svg')
        .then(res => res.text())
        .then(svgText => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgEl = doc.querySelector('svg');
            if (!svgEl) return;

            let w = 240;
            let h = 60;
            const vb = svgEl.getAttribute('viewBox');
            if (vb) {
                const parts = vb.trim().split(/[\s,]+/).map(Number);
                if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                    const ratio = parts[2] / parts[3];
                    h = 120;
                    w = Math.round(h * ratio);
                }
            }
            svgEl.setAttribute('width', `${w}px`);
            svgEl.setAttribute('height', `${h}px`);

            const serialized = new XMLSerializer().serializeToString(svgEl);
            const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                preloadedLogoDataUrl = canvas.toDataURL('image/png');
                URL.revokeObjectURL(url);

                document.querySelectorAll('.wm-logo-img').forEach(el => {
                    el.src = preloadedLogoDataUrl;
                });
            };
            img.src = url;
        })
        .catch(() => {});
}

// Tự động căn lại chấm định vị 3D và nhãn mã căn trên SVG khi thay đổi kích thước cửa sổ
window.addEventListener('resize', () => {
    position3DMarkerInCoverImage(document);
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

function padUnitSegment(seg) {
    const clean = String(seg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = clean.match(/^(\d+)([A-Z]*)$/);
    if (!m) return clean;
    const numPart = m[1].length === 1 ? '0' + m[1] : m[1];
    return `${numPart}${m[2]}`;
}

function normalizeUnitCode(input) {
    let clean = String(input || '').trim().toUpperCase().replace(/[-_,\s]+/g, '.');
    if (!clean) return '';

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

    const compact = clean.replace(/^R/, '');

    const specialFloorCompact = compact.match(/^(\d{2}[A-Z])(\d{1,2}[A-Z]?)$/);
    if (specialFloorCompact) {
        return `R.${specialFloorCompact[1]}.${padUnitSegment(specialFloorCompact[2])}`;
    }

    const tokens = compact.match(/\d+[A-Z]?/g);
    if (tokens && tokens.length >= 2) {
        const floor = padUnitSegment(tokens[0]);
        const unit = padUnitSegment(tokens[1]);
        return `R.${floor}.${unit}`;
    }

    const singleMatch = compact.match(/^(\d+)([A-Z]?)$/);
    if (singleMatch) {
        const digits = singleMatch[1];
        const suffixLetter = singleMatch[2];

        if (digits.length === 2) {
            return `R.0${digits[0]}.0${digits[1]}${suffixLetter}`;
        }
        if (digits.length === 3) {
            if (digits.startsWith('0')) {
                return `R.${digits.slice(0, 2)}.0${digits.slice(2)}${suffixLetter}`;
            }
            return `R.0${digits[0]}.${digits.slice(1)}${suffixLetter}`;
        }
        if (digits.length === 4) {
            return `R.${digits.slice(0, 2)}.${digits.slice(2)}${suffixLetter}`;
        }
        if (digits.length >= 5) {
            return `R.${digits.slice(0, 3)}.${padUnitSegment(digits.slice(3))}${suffixLetter}`;
        }
    }

    return clean.startsWith('R.') ? clean : (clean.startsWith('R') ? 'R.' + clean.slice(1) : 'R.' + clean);
}

function formatSearchInputLive(rawValue) {
    let val = String(rawValue || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!val) return '';

    if (val === 'R') return 'R.';
    if (!val.startsWith('R')) {
        val = 'R.' + val;
    } else if (val.length >= 2 && val[1] !== '.') {
        val = 'R.' + val.slice(1);
    }

    let rest = val.slice(2).replace(/\.+/g, '.');
    if (!rest) return 'R.';

    if (rest.includes('.')) {
        const dotIdx = rest.indexOf('.');
        let floorPart = rest.slice(0, dotIdx).replace(/\./g, '');
        let unitPart = rest.slice(dotIdx + 1).replace(/\./g, '');

        if (/^\d$/.test(floorPart)) {
            floorPart = '0' + floorPart;
        }
        return `R.${floorPart}.${unitPart}`;
    }

    if (/^\d{2}/.test(rest)) {
        const firstTwo = rest.slice(0, 2);
        const afterTwo = rest.slice(2);

        if (!afterTwo) {
            return `R.${firstTwo}`;
        }

        if (/^[A-Z]/.test(afterTwo)) {
            const letter = afterTwo[0];
            const unitDigits = afterTwo.slice(1);
            return `R.${firstTwo}${letter}.${unitDigits}`;
        }

        if (/^\d/.test(afterTwo)) {
            return `R.${firstTwo}.${afterTwo}`;
        }
    }

    if (/^[3-9]\d/.test(rest)) {
        return `R.0${rest[0]}.${rest.slice(1)}`;
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

function searchApartment(overrideCode) {
    if (apartmentData.length === 0) {
        alert('Dữ liệu đang được tải, vui lòng đợi trong giây lát!');
        return;
    }

    const inputEl = document.getElementById('searchInput');
    const rawQuery = (overrideCode !== undefined ? String(overrideCode) : inputEl.value).trim();
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

    // 4. Render Bảng giá theo PTTT
    renderPaymentPlans(row);

    // 5. Cập nhật ảnh 3D tòa nhà & điểm định vị
    update3DBuildingMarker(row, unitCode);

    // 6. Nạp & đánh dấu mặt bằng SVG tầng từ thư mục svg/
    updateFloorPlanSVG(row, unitCode);

    // 7. Cập nhật Layout & Diễn họa nội thất từ thư mục images/
    updateMediaCards(row);
}

// =========================================================================
// 4. BẢNG QUỸ CĂN MỞ BÁN GIAI ĐOẠN NÀY (CÓ GIÁ TRẦN)
// =========================================================================
function openInventoryModal() {
    if (apartmentData.length === 0) {
        alert('Dữ liệu đang được tải, vui lòng đợi trong giây lát!');
        return;
    }
    const modal = document.getElementById('modalInventory');
    if (modal) {
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        filterInventoryTable();
    }
}

function closeInventoryModal() {
    const modal = document.getElementById('modalInventory');
    if (modal) {
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
    }
}

function populateInventoryFilters() {
    const floorSelect = document.getElementById('invFilterFloor');
    const typeSelect = document.getElementById('invFilterType');
    if (!floorSelect || !typeSelect) return;

    const floors = new Set();
    const types = new Set();

    openForSaleUnits.forEach(row => {
        const code = normalizeUnitCode(getCol(row, ['mã căn hộ', 'mã căn']));
        const parts = code.split('.');
        const floor = getCol(row, ['tầng']) || (parts.length >= 2 ? parts[1] : '');
        if (isValidValue(floor)) floors.add(padUnitSegment(floor));

        const pType = getCol(row, ['loại hình sản phẩm', 'loại hình']);
        if (isValidValue(pType)) types.add(pType.trim());
    });

    const sortedFloors = Array.from(floors).sort((a, b) => {
        const idxA = CONFIG.PHYSICAL_FLOORS.indexOf(a.replace(/^0+/, ''));
        const idxB = CONFIG.PHYSICAL_FLOORS.indexOf(b.replace(/^0+/, ''));
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        return a.localeCompare(b, undefined, { numeric: true });
    });

    floorSelect.innerHTML = '<option value="">Tất cả tầng</option>' +
        sortedFloors.map(f => `<option value="${f}">Tầng ${f}</option>`).join('');

    typeSelect.innerHTML = '<option value="">Tất cả loại hình</option>' +
        Array.from(types).sort().map(t => `<option value="${t}">${t}</option>`).join('');
}

function filterInventoryTable() {
    const kw = (document.getElementById('invSearchInput')?.value || '').trim().toUpperCase();
    const floorFilter = document.getElementById('invFilterFloor')?.value || '';
    const typeFilter = document.getElementById('invFilterType')?.value || '';

    const filtered = openForSaleUnits.filter(row => {
        const rawCode = getCol(row, ['mã căn hộ', 'mã căn']);
        const normCode = normalizeUnitCode(rawCode);
        const parts = normCode.split('.');
        const floor = padUnitSegment(getCol(row, ['tầng']) || (parts.length >= 2 ? parts[1] : ''));
        const pType = getCol(row, ['loại hình sản phẩm', 'loại hình']).trim();

        if (kw && !normCode.includes(kw) && !rawCode.toUpperCase().includes(kw)) return false;
        if (floorFilter && floor !== floorFilter) return false;
        if (typeFilter && pType !== typeFilter) return false;
        return true;
    });

    renderInventoryTable(filtered);
}

function renderInventoryTable(list) {
    const tbody = document.getElementById('inventoryTableBody');
    const summaryEl = document.getElementById('invResultSummary');
    if (!tbody) return;

    if (summaryEl) {
        summaryEl.innerText = `Hiển thị ${list.length} / ${openForSaleUnits.length} căn mở bán`;
    }

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="inv-empty-cell">Không tìm thấy căn hộ phù hợp với điều kiện lọc</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map((row, index) => {
        const unitCode = getCol(row, ['mã căn hộ', 'mã căn']) || '---';
        const pType = getCol(row, ['loại hình sản phẩm', 'loại hình']) || '---';
        const direction = translateDirection(getCol(row, ['hướng'])) || '---';
        const areaNet = getCol(row, ['tổng diện tích thông thuỷ', 'tổng diện tích thông thủy', 'diện tích thông thủy']);
        const areaGross = getCol(row, ['tổng diện tích tim tường', 'diện tích tim tường']);
        const areaDisplay = isValidValue(areaNet)
            ? `${areaNet} m²`
            : (isValidValue(areaGross) ? `${areaGross} m² (tim tường)` : '---');
        const ceilingPrice = formatPrice(getCol(row, ['giá trần', 'giá bán'])) || '---';

        return `
            <tr>
                <td class="inv-col-stt">${index + 1}</td>
                <td class="inv-col-code"><span class="inv-code-badge">${unitCode}</span></td>
                <td>${pType}</td>
                <td>${direction}</td>
                <td class="inv-col-area">${areaDisplay}</td>
                <td class="inv-col-price">${ceilingPrice}</td>
                <td class="inv-col-action">
                    <button type="button" class="btn-select-unit" onclick="selectUnitFromInventory('${unitCode.replace(/'/g, "\\'")}')">
                        Xem căn
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function selectUnitFromInventory(unitCode) {
    closeInventoryModal();
    searchApartment(unitCode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =========================================================================
// 5. BẢNG GIÁ THEO PHƯƠNG ÁN THANH TOÁN (NÚT + VÀ - CỐ ĐỊNH CÙNG VỊ TRÍ)
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
// 6. ĐỊNH VỊ ĐIỂM CHẤM TRÊN ẢNH PHỐI CẢNH 3D TÒA NHÀ (KHỚP 100% TỶ LỆ GỐC)
// =========================================================================
function position3DMarkerInCoverImage(targetDoc = document) {
    const img3D = targetDoc.getElementById('img3D');
    const box = img3D ? img3D.parentElement : null;
    const marker = targetDoc.getElementById('marker3DWrapper');
    if (!img3D || !box || !marker) return;

    const posX = parseFloat(marker.dataset.posX);
    const finalY = parseFloat(marker.dataset.finalY);
    if (isNaN(posX) || isNaN(finalY)) {
        marker.style.display = 'none';
        return;
    }

    const boxW = box.clientWidth;
    const boxH = box.clientHeight;
    const nw = img3D.naturalWidth;
    const nh = img3D.naturalHeight;

    if (!boxW || !boxH || !nw || !nh) {
        marker.style.left = `${posX}%`;
        marker.style.top = `${finalY}%`;
        marker.classList.toggle('flip-left', posX > 72);
        marker.style.display = 'flex';
        return;
    }

    // Tính vùng hiển thị thực tế của ảnh gốc bên trong khung object-fit: cover
    const imgRatio = nw / nh;
    const boxRatio = boxW / boxH;

    let renderedW, renderedH, offsetX, offsetY;
    if (imgRatio > boxRatio) {
        renderedH = boxH;
        renderedW = boxH * imgRatio;
        offsetX = (boxW - renderedW) / 2;
        offsetY = 0;
    } else {
        renderedW = boxW;
        renderedH = boxW / imgRatio;
        offsetX = 0;
        offsetY = (boxH - renderedH) / 2;
    }

    const pxX = offsetX + (posX / 100) * renderedW;
    const pxY = offsetY + (finalY / 100) * renderedH;

    marker.style.left = `${pxX}px`;
    marker.style.top = `${pxY}px`;
    marker.classList.toggle('flip-left', (pxX / boxW) > 0.72);
    marker.style.display = 'flex';
}

function update3DBuildingMarker(row, unitCode) {
    const img3D = document.getElementById('img3D');
    const ph3D = document.getElementById('placeholder3D');
    const marker = document.getElementById('marker3DWrapper');

    const custom3D = getCol(row, ['ảnh 3d', 'anh 3d']);
    const imgSrc = isValidValue(custom3D) ? resolveImagePath(custom3D, 'jpg') : CONFIG.DEFAULT_3D_IMAGE;

    const rawX = getCol(row, ['tọa độ x', 'toạ độ x']);
    const rawY = getCol(row, ['tọa độ y', 'toạ độ y']);
    const rawStep = getCol(row, ['bước nhảy']);

    const posX = parseFloat(String(rawX).replace(',', '.'));
    const yStr = String(rawY || '').trim();
    const baseY = parseFloat(yStr.replace(',', '.'));
    const stepY = parseFloat(String(rawStep || '0').replace(',', '.')) || 0;

    let finalY = baseY;

    if (!isNaN(posX) && !isNaN(baseY) && stepY !== 0) {
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

    if (isNaN(posX) || isNaN(finalY)) {
        delete marker.dataset.posX;
        delete marker.dataset.finalY;
        marker.style.display = 'none';
    } else {
        marker.dataset.posX = String(posX);
        marker.dataset.finalY = String(finalY);
    }

    delete img3D.dataset.triedPng;
    delete img3D.dataset.triedJpg;
    img3D.style.display = 'block';
    ph3D.style.display = 'none';

    img3D.onload = () => position3DMarkerInCoverImage(document);

    if (img3D.getAttribute('src') !== imgSrc) {
        img3D.src = imgSrc;
    }

    if (img3D.complete && img3D.naturalWidth > 0) {
        position3DMarkerInCoverImage(document);
    }
}

// =========================================================================
// 7. NẠP & ĐÁNH DẤU MẶT BẰNG TẦNG SVG (HỖ TRỢ MÃ HEX 2 & 4 CHỮ SỐ CỦA ILLUSTRATOR)
// =========================================================================
function decodeIllustratorId(rawStr) {
    if (!rawStr) return '';
    let decoded = String(rawStr).replace(/_x([0-9A-Fa-f]{2,4})_/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    );
    decoded = decoded.replace(/_\d+_?$/, '').replace(/-\d+$/, '').replace(/^_+/, '');
    return decoded.trim().toUpperCase();
}

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

function isInsideBgGroup(el, svgRoot) {
    let curr = el;
    while (curr && curr !== svgRoot) {
        if (curr.tagName && curr.tagName.toLowerCase() === 'defs') return true;
        const names = [
            curr.getAttribute && curr.getAttribute('id'),
            curr.getAttribute && curr.getAttribute('data-name')
        ].filter(Boolean);
        for (const n of names) {
            if (decodeIllustratorId(n) === 'BG') return true;
        }
        curr = curr.parentElement;
    }
    return false;
}

function extractAxisTokenFromElement(el) {
    const directTitleEl = Array.from(el.children || []).find(
        c => c.tagName && c.tagName.toLowerCase() === 'title'
    );
    const rawNames = [
        el.getAttribute('data-name'),
        el.getAttribute('id'),
        el.getAttribute('inkscape:label'),
        directTitleEl ? directTitleEl.textContent : ''
    ].filter(Boolean);

    for (const rawName of rawNames) {
        const decoded = decodeIllustratorId(rawName);
        if (!decoded || decoded === 'LAYER_1' || decoded === 'LAYER1' || decoded === 'BG') continue;

        if (/^\d{1,2}[A-Z]?$/.test(decoded)) {
            return normalizePaddedAxis(decoded);
        }

        const prefixMatch = decoded.match(/^(?:CĂN|CAN|CH|UNIT|APT|P|NO)[_\-.\s]*(\d{1,2}[A-Z]?)$/);
        if (prefixMatch) {
            return normalizePaddedAxis(prefixMatch[1]);
        }

        const fullMatch = decoded.match(/^(?:R[.\-_\s]*)?\d{1,2}[A-Z]?[.\-_\s]+(\d{1,2}[A-Z]?)$/);
        if (fullMatch) {
            return normalizePaddedAxis(fullMatch[1]);
        }
    }

    return '';
}

function clearSvgUnitStyle(el) {
    const hideNode = node => {
        node.style.setProperty('opacity', '0', 'important');
        node.style.setProperty('fill', 'transparent', 'important');
        node.style.setProperty('stroke', 'transparent', 'important');
        node.style.removeProperty('mix-blend-mode');
    };
    hideNode(el);
    el.querySelectorAll('polygon, path, rect, polyline, circle').forEach(hideNode);
}

function highlightSvgUnitStyle(el, svgRoot) {
    const highlightFill = '#eb4d24';
    const highlightStroke = '#c92a14';

    let parent = el.parentElement;
    let topContainer = el;
    while (parent && parent !== svgRoot) {
        if (parent.tagName && parent.tagName.toLowerCase() === 'g') {
            parent.removeAttribute('display');
            parent.style.setProperty('display', 'inline', 'important');
            parent.style.setProperty('visibility', 'visible', 'important');
            parent.style.setProperty('opacity', '1', 'important');
            if (parent.parentElement === svgRoot) {
                topContainer = parent;
            }
        }
        parent = parent.parentElement;
    }

    if (topContainer && topContainer.parentElement === svgRoot) {
        svgRoot.appendChild(topContainer);
    }

    const applyHighlight = node => {
        node.removeAttribute('display');
        node.style.setProperty('opacity', '1', 'important');
        node.style.setProperty('display', 'inline', 'important');
        node.style.setProperty('visibility', 'visible', 'important');
        node.style.setProperty('fill', highlightFill, 'important');
        node.style.setProperty('fill-opacity', '0.55', 'important');
        node.style.setProperty('stroke', highlightStroke, 'important');
        node.style.setProperty('stroke-width', '1.5px', 'important');
        node.style.setProperty('mix-blend-mode', 'normal', 'important');
    };

    applyHighlight(el);
    el.querySelectorAll('polygon, path, rect, polyline, circle').forEach(applyHighlight);
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

            const sttRaw = getCol(row, ['stt căn', 'stt']);
            const codeParts = unitCode.split('.');
            const codeSuffixRaw = codeParts.length >= 3 ? codeParts[2] : '';

            const targetFromStt = isValidValue(sttRaw) ? normalizePaddedAxis(sttRaw) : '';
            const targetFromCode = isValidValue(codeSuffixRaw) ? normalizePaddedAxis(codeSuffixRaw) : '';

            const unitCandidates = [];
            const allElements = svgEl.querySelectorAll('g, polygon, path, rect, polyline');

            allElements.forEach(el => {
                if (isInsideBgGroup(el, svgEl)) return;

                const axisToken = extractAxisTokenFromElement(el);
                if (axisToken) {
                    clearSvgUnitStyle(el);
                    unitCandidates.push({ el, axisToken });
                }
            });

            let matched = null;
            if (targetFromStt) {
                matched = unitCandidates.find(item => item.axisToken === targetFromStt);
            }
            if (!matched && targetFromCode) {
                matched = unitCandidates.find(item => item.axisToken === targetFromCode);
            }

            if (matched && matched.el) {
                highlightSvgUnitStyle(matched.el, svgEl);
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
// 8. CẬP NHẬT ẢNH LAYOUT & DIỄN HỌA NỘI THẤT (FOLDER images/)
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
// 9. XUẤT ẢNH BÁO GIÁ (GIỮ ĐÚNG TỶ LỆ GỐC & ĐỒNG BỘ CHẤM ĐỊNH VỊ)
// =========================================================================
function preserveImageAspectInClone(clonedDoc, imgId, fitMode) {
    const img = clonedDoc.getElementById(imgId);
    const box = img ? img.parentElement : null;
    if (!img || !box || img.style.display === 'none') return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;

    const style = clonedDoc.defaultView.getComputedStyle(box);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const boxW = box.clientWidth - padX;
    const boxH = box.clientHeight - padY;
    if (boxW <= 0 || boxH <= 0) return;

    const imgRatio = nw / nh;
    const boxRatio = boxW / boxH;

    let renderW, renderH;
    if (fitMode === 'cover') {
        if (imgRatio > boxRatio) {
            renderH = boxH;
            renderW = boxH * imgRatio;
        } else {
            renderW = boxW;
            renderH = boxW / imgRatio;
        }
    } else {
        if (imgRatio > boxRatio) {
            renderW = boxW;
            renderH = boxW / imgRatio;
        } else {
            renderH = boxH;
            renderW = boxH * imgRatio;
        }
    }

    img.style.setProperty('width', `${renderW}px`, 'important');
    img.style.setProperty('height', `${renderH}px`, 'important');
    img.style.setProperty('max-width', 'none', 'important');
    img.style.setProperty('max-height', 'none', 'important');
    img.style.setProperty('position', 'absolute', 'important');
    img.style.setProperty('left', `${(box.clientWidth - renderW) / 2}px`, 'important');
    img.style.setProperty('top', `${(box.clientHeight - renderH) / 2}px`, 'important');
    img.style.setProperty('object-fit', 'fill', 'important');
}

function exportImage() {
    const container = document.getElementById('exportContainer');
    const wmCenter = document.getElementById('watermarkOverlayCenter');
    const wmFooter = document.getElementById('watermarkFooterBar');
    const unitCode = document.getElementById('lblMaCanTop').innerText.trim() || 'BaoGia';

    if (preloadedLogoDataUrl) {
        document.querySelectorAll('.wm-logo-img').forEach(el => {
            el.src = preloadedLogoDataUrl;
        });
    }

    container.classList.add('exporting-mode');
    if (wmCenter) wmCenter.style.display = 'flex';
    if (wmFooter) wmFooter.style.display = 'flex';

    requestAnimationFrame(() => {
        html2canvas(container, {
            useCORS: true,
            scale: 2,
            backgroundColor: null,
            onclone: clonedDoc => {
                preserveImageAspectInClone(clonedDoc, 'img3D', 'cover');
                preserveImageAspectInClone(clonedDoc, 'imgInterior', 'cover');
                preserveImageAspectInClone(clonedDoc, 'imgLayout', 'contain');
                position3DMarkerInCoverImage(clonedDoc);
            }
        })
            .then(canvas => {
                const link = document.createElement('a');
                link.download = `Radisson_${unitCode.replace(/\./g, '_')}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            })
            .finally(() => {
                if (wmCenter) wmCenter.style.display = 'none';
                if (wmFooter) wmFooter.style.display = 'none';
                container.classList.remove('exporting-mode');
            });
    });
}

// =========================================================================
// 10. LIGHTBOX PHÓNG TO & KÉO THẢ LAYOUT NỘI THẤT (DUPLEX)
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
// 11. POPUP 360 ĐỘ THỰC TẾ & 360 ĐỘ DIỄN HỌA
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
// 12. CHẾ ĐỘ BẢO VỆ MÃ NGUỒN (CẤM F12, CẤM COPY, CẤM KIỂM TRA CODE)
// =========================================================================
function initSourceProtection() {
    document.addEventListener('contextmenu', e => {
        e.preventDefault();
        return false;
    }, true);

    ['selectstart', 'copy', 'cut', 'dragstart'].forEach(evtName => {
        document.addEventListener(evtName, e => {
            if (e.target && (e.target.id === 'searchInput' || e.target.id === 'invSearchInput')) return;
            e.preventDefault();
            return false;
        }, true);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeImageLightbox();
            close360RealModal();
            close360RenderModal();
            closeInventoryModal();
            return;
        }

        const key = (e.key || '').toUpperCase();
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;

        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        if ((isCtrlOrMeta && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key)) ||
            (e.metaKey && e.altKey && ['I', 'J', 'C', 'U'].includes(key))) {
            e.preventDefault();
            return false;
        }

        if (isCtrlOrMeta && ['U', 'S', 'P'].includes(key)) {
            e.preventDefault();
            return false;
        }

        if (isCtrlOrMeta && ['C', 'X', 'A'].includes(key)) {
            if (document.activeElement && (document.activeElement.id === 'searchInput' || document.activeElement.id === 'invSearchInput')) return;
            e.preventDefault();
            return false;
        }
    }, true);

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
