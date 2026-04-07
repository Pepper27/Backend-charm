# Mix Charm (Pandora-like) Spec (Guest MVP)

Tài liệu này chốt scope và contract cho chức năng **mix charm** kiểu Pandora trong dự án hiện tại (backend Express + MongoDB). Mục tiêu trước mắt: **guest** có thể mix và **add 1 line bundle** vào cart. Chưa có customer auth/JWT.

## Scope

- Guest:
  - Chọn vòng (bracelet) + chọn charms để mix theo slot.
  - Validate rule Pandora-like.
  - Add vào cart dưới dạng **1 bundle line item**.
  - Không lưu “My designs”.
- Logged-in user: để phase sau (khi có customer auth/JWT).
- Try-on:
  - Phase sau. Hiện tại FE có thể tự render + **download PNG** từ canvas (backend không cần endpoint).

## Category Slug Conventions (Backend dựa vào slug)

### Canonical (theo spec ban đầu)

- Bracelet root category: `bracelet`
- Bracelet type (category con của `bracelet`):
  - `snake-chain`
  - `bangle`
  - `leather`
- Charm root category: `charm`
- Clip charm category: `clip` (là con của `charm`, backend lấy cả subtree)

### Dataset thực tế (VN slug)

Trong DB hiện tại, category slug không theo canonical. Backend đã được chỉnh để hỗ trợ qua config:

- Bracelet root: `vong-tay`
- Bracelet types (slug con của `vong-tay`):
  - snake-chain tương đương: `vong-tay-mem`
  - bangle tương đương: `vong-kieng`
  - leather tương đương: `vong-da-U2oezSEXV` (và alias `vong-da`)
- Charm categories:
  - Có root `charm-zBoaPLB6r` (dataset) và có 1 node `charm` (nhưng có thể không được dùng làm root trực tiếp trong cây).
  - Một số charm category có thể bị “mồ côi” (parent trỏ tới id khác), nên backend fallback theo prefix slug `^charm-`.
- Clip charm (charm chặn): slug dataset là `charm-chan` (thay cho `clip`).

Config nằm tại: `config/mix-category-slugs.js`.

## Bracelet Type Inference

Backend sẽ **tự suy `typeCode`** từ category của bracelet product (FE không gửi typeCode cho validate/cart):

1. Load `Product` theo `bracelet.productId`.
2. Lấy `categoryId` của product.
3. Dò chain parent lên tới root `bracelet`.
4. `typeCode` là slug của node **ngay dưới** root bracelet (canonical hoặc VN) trong chain.
5. Nếu không xác định được `typeCode` => lỗi cấu hình dữ liệu.

## Clip Charm Detection

Charm được xem là **clip** nếu `product.category` nằm trong subtree của category slug `clip`.

## Mixing Rules (Pandora-like)

### Slot rules

- Mỗi bracelet (theo `typeCode` + `sizeCm`) có:
  - `recommendedCharms`
  - `maxCharms`
- `slotCount = maxCharms`
- Một slot chỉ được đặt **tối đa 1 charm**.
- Cho phép cùng 1 charm đặt ở nhiều slot khác nhau (không cấm trùng `charmProductId`).

### Clip zones (snake-chain)

- `snake-chain` có khái niệm **clip zones = 3 vùng**.
- Clip charm **không bắt buộc** phải có.
- Nếu bracelet là snake-chain (canonical `snake-chain` hoặc VN `vong-tay-mem`) và charm là clip:
  - `slotIndex` phải thuộc `clipZones`.

Clip zone được cấu hình theo **tỉ lệ chiều dài vòng**:

- `clipZonePercents = [0.25, 0.5, 0.75]`
- Từ `slotCount = N`, tính index:
  - `idx = round((N - 1) * percent)`
- Đảm bảo 3 index là unique (nếu trùng thì dịch +/- 1 để đủ 3 index hợp lệ).

### Pricing

- `braceletPrice` = giá của bracelet variant được chọn.
- `charmsPrice` = tổng giá của tất cả charm variants được chọn.
- `total = braceletPrice + charmsPrice`.

### Stock (optional)

- Có thể bật check tồn kho theo `variant.quantity > 0` cho từng item.

## Default Mix Rule Config (tạm dùng)

Mục tiêu: “đúng logic thực tế” và dễ chỉnh sau.

### snake-chain

Sizes: 16, 17, 18, 19, 20

- 16: `{ recommendedCharms: 14, maxCharms: 18 }` (theo ví dụ)
- 17: `{ recommendedCharms: 15, maxCharms: 19 }`
- 18: `{ recommendedCharms: 16, maxCharms: 20 }`
- 19: `{ recommendedCharms: 17, maxCharms: 21 }`
- 20: `{ recommendedCharms: 18, maxCharms: 22 }`

### bangle (ít hơn snake-chain)

- 16: `{ recommendedCharms: 10, maxCharms: 14 }`
- 17: `{ recommendedCharms: 11, maxCharms: 15 }`
- 18: `{ recommendedCharms: 12, maxCharms: 16 }`
- 19: `{ recommendedCharms: 13, maxCharms: 17 }`
- 20: `{ recommendedCharms: 14, maxCharms: 18 }`

### leather (ít hơn bangle)

- 16: `{ recommendedCharms: 8, maxCharms: 12 }`
- 17: `{ recommendedCharms: 9, maxCharms: 13 }`
- 18: `{ recommendedCharms: 10, maxCharms: 14 }`
- 19: `{ recommendedCharms: 11, maxCharms: 15 }`
- 20: `{ recommendedCharms: 12, maxCharms: 16 }`

## Public API Contract

### Catalog

1. `GET /api/public/bracelets?typeCode=<slug>&sizeCm=17`
   - Lọc products thuộc subtree bracelet/type theo `typeCode` (typeCode optional).
   - `typeCode` có thể là canonical hoặc VN slug (do backend có alias map).
   - Response có thể kèm rule cho size:
      - `{ typeCode, sizeCm, recommendedCharms, slotCount, clipZonePercents, clipZones }`

2. `GET /api/public/charms?kind=clip|regular`
   - `clip`: subtree `clip`
   - `regular`: subtree `charm` trừ subtree `clip`

### Mix Validate

`POST /api/public/mix/validate`

Request:

```json
{
  "bracelet": { "productId": "...", "variantCode": "...", "sizeCm": 17 },
  "items": [
    { "slotIndex": 5, "charmProductId": "...", "charmVariantCode": "..." }
  ]
}
```

Response (format chốt):

```json
{
  "valid": true,
  "errors": [],
  "slotCount": 19,
  "recommendedCharms": 15,
  "clipZones": [5, 9, 14],
  "pricing": { "braceletPrice": 1290000, "charmsPrice": 990000, "total": 2280000 },
  "clipZonePercents": [0.25, 0.5, 0.75]
}
```

Notes:

- FE **không gửi** `typeCode`; backend tự suy theo category.
- `clipZones` chỉ meaningful cho `snake-chain`.

## Guest Cart (Bundle Line Item)

Cookie:

- Backend set cookie `guestId` (uuid) nếu chưa có.
- FE gọi API với `credentials: "include"`.

Endpoints:

- `POST /api/public/cart/bundles` (tạo bundle line từ payload validate)
- `GET /api/public/cart` (xem cart)
- `PATCH /api/public/cart/bundles/:bundleId` (đổi qty hoặc cập nhật items)
- `DELETE /api/public/cart/bundles/:bundleId`

Bundle lưu trong cart (snapshot):

- `bundleId`
- `bracelet { productId, variantCode, sizeCm, typeCode }`
- `items[] { slotIndex, charmProductId, charmVariantCode }`
- `rulesSnapshot { slotCount, recommendedCharms, clipZonePercents }`
- `priceSnapshot { braceletPrice, charmsPrice, total }`
- `quantity`

## Non-goals (MVP)

- Không làm customer auth/JWT.
- Không làm AR/3D.
- Không render try-on phía backend.

---

## Kết quả phiên làm việc (Mon Apr 06 2026)

### Backend (repo này: `Backend-charm/`)

Đã implement MVP public API cho mix charm + guest cart bundle.

- Public routes được mount tại `index.js`: `app.use("/api/public", publicRoutes)`
- Endpoints:
  - `GET /api/public/bracelets?typeCode=&sizeCm=`
  - `GET /api/public/charms?kind=clip|regular`
  - `POST /api/public/mix/validate`
  - `GET /api/public/cart`
  - `POST /api/public/cart/bundles`
  - `PATCH /api/public/cart/bundles/:bundleId`
  - `DELETE /api/public/cart/bundles/:bundleId`
- Guest cookie:
  - `helper/guest.helper.js` set cookie `guestId` (httpOnly) và FE phải gọi với `credentials: "include"`.
- Rule config:
  - `config/mix-rules.js` chứa default rules + `computeClipZones()` + `isSnakeChainType()`.
  - Có thêm alias rules cho VN slug (`vong-tay-mem`, `vong-kieng`, `vong-da*`).
- Category mapping theo dataset:
  - `config/mix-category-slugs.js` định nghĩa root/type/clip slugs + alias.
  - `helper/mix-category.helper.js` load root theo config, hỗ trợ charm fallback theo slug prefix `^charm-`, clip theo `charm-chan`.
- Fix quan trọng do dataset hiện tại:
  - `product.category` trong DB đang lưu **string** (không phải ObjectId). Vì vậy catalog controller đã chuyển sang `aggregate` và match `$in` với cả string + ObjectId.
  - File: `controllers/public/catalog.controller.js`.
- Cart model:
  - `models/cart.model.js` thêm `guestId` và `bundles[]` snapshot (bracelet/items/rulesSnapshot/priceSnapshot/quantity).
- Repo hygiene:
  - `.gitignore` thêm `.DS_Store`.

Test nhanh đã chạy OK trên máy local:

- `GET /api/public/cart` trả cart rỗng và set cookie.
- `GET /api/public/bracelets?typeCode=vong-tay-mem&sizeCm=17` trả list vòng + rule + clipZones.
- `GET /api/public/charms` trả list charm.
- `POST /api/public/mix/validate` trả `valid: true` với payload mẫu.
- `POST /api/public/cart/bundles` add bundle OK.

### Frontend (repo khác: `/Users/macbookpro/mern-jewelry/frontend2/`)

Lưu ý: frontend không nằm trong repo backend này, nhưng các thay đổi đã thực hiện trong phiên làm việc để builder usable.

- Route `/design`: builder page.
- Preview canvas:
  - Vẽ vòng làm nền + charm overlay.
  - Xóa nền trắng của charm (flood-fill từ viền) + crop sát vật thể.
  - Thêm kéo thả charm trực tiếp trên canvas (preview-only), có nút reset vị trí.
  - Khi gọi `validateMix` và `addBundleToCart`, FE chỉ gửi `{slotIndex, charmProductId, charmVariantCode}` (không gửi offset).
- `src/utils/api.js` dùng `credentials: "include"` cho guest cookie.

Known gaps:

- `GET /api/public/charms?kind=clip` hiện trả rỗng nếu DB chưa có product nào thuộc category `charm-chan`.
- Ảnh sản phẩm nền trắng/đổ bóng nặng có thể vẫn còn halo; muốn “thật” nhất cần asset PNG đã tách nền.
