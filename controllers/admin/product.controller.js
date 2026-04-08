const Product = require("../../models/product.model");
const AccountAdmin = require("../../models/accountAdmin.model");
const helper = require("../../helper/generate.helper")
const mongoose = require("mongoose");
const slugify = require("slugify");

const withTimeout = (query, ms = 8000) => {
  if (!query?.maxTimeMS) return query;
  return query.maxTimeMS(ms);
};

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return JSON.parse(value);
  // Already parsed (application/json) or provided as object/array.
  return value;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const calculateStockStatus = (product) => {
  const totalStock = (product?.variants || []).reduce((sum, v) => sum + (v?.quantity || 0), 0);
  if (totalStock === 0) return "out_of_stock";
  if (totalStock < 5) return "low_stock";
  return "in_stock";
};

const enrichProductWithStatus = (product) => {
  const obj = product.toObject ? product.toObject() : product;
  return {
    ...obj,
    stockStatus: calculateStockStatus(product),
  };
};
module.exports.getProducts = async (req,res)=>{
    try {
        const find={
            deleted:false
        }
        const {startDate,endDate,keyword,minPrice,maxPrice,createdBy,stockStatus,categoryId,material} = req.query
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const parsedLimit = parseInt(req.query.limit, 10) || 10;
        const limit = Math.min(Math.max(parsedLimit, 1), 50);

        if (startDate || endDate) {
          const createdAtFilter = {};
          if (startDate) {
            const start = new Date(startDate);
            if (Number.isNaN(start.getTime())) {
              return res.status(400).json({ message: "startDate không hợp lệ" });
            }
            start.setHours(0, 0, 0, 0);
            createdAtFilter.$gte = start;
          }
          if (endDate) {
            const end = new Date(endDate);
            if (Number.isNaN(end.getTime())) {
              return res.status(400).json({ message: "endDate không hợp lệ" });
            }
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$lte = end;
          }
          if (createdAtFilter.$gte && createdAtFilter.$lte && createdAtFilter.$gte > createdAtFilter.$lte) {
            return res.status(400).json({ message: "startDate không được lớn hơn endDate" });
          }
          find.createdAt = createdAtFilter;
        }

        if (createdBy) {
          const creatorValue = String(createdBy).trim();
          if (mongoose.Types.ObjectId.isValid(creatorValue)) {
            find.createdBy = { $in: [creatorValue, new mongoose.Types.ObjectId(creatorValue)] };
          } else {
            // Support partial, case-insensitive name matching (contains)
            const creators = await AccountAdmin.find({
              fullName: { $regex: new RegExp(escapeRegex(creatorValue), "i") },
              deleted: false,
            }).select("_id").lean();

            if (!creators.length) {
              return res.status(200).json({
                data: [],
                total: 0,
                currentPage: 1,
                totalPage: 1,
                limit,
              });
            }

            const creatorIds = creators.map((item) => item._id);
            find.createdBy = { $in: [...creatorIds, ...creatorIds.map((id) => id.toString())] };
          }
        }
        if (categoryId) {
          const categoryValue = String(categoryId).trim();
          if (!mongoose.Types.ObjectId.isValid(categoryValue)) {
            return res.status(400).json({ message: "categoryId không hợp lệ" });
          }
          find.category = new mongoose.Types.ObjectId(categoryValue);
        }

        const keywordTrim = String(keyword || "").trim();
        if (keywordTrim) {
          const or = [];

          // Match by id if user pastes ObjectId
          if (mongoose.Types.ObjectId.isValid(keywordTrim)) {
            or.push({ _id: new mongoose.Types.ObjectId(keywordTrim) });
          }

          // Match variant code (contains)
          or.push({ "variants.code": { $regex: new RegExp(escapeRegex(keywordTrim), "i") } });

          // Match name via slug (accent-insensitive)
          const slugKeyword = slugify(keywordTrim, { lower: true, strict: true });
          if (slugKeyword) {
            or.push({ slug: { $regex: new RegExp(escapeRegex(slugKeyword), "i") } });
          }

          find.$or = or;
        }

        const products = await withTimeout(
          Product.find(find)
            .populate({ path: "category", select: "name" })
            .populate({ path: "createdBy", select: "_id fullName email" })
            .sort({ createdAt: -1 })
            .lean()
        );

        let filtered = products;

        // Filter by material and/or price range.
        // If both are provided, they must match within the same variant.
        const hasMin = minPrice !== undefined && minPrice !== "";
        const hasMax = maxPrice !== undefined && maxPrice !== "";
        const hasPriceFilter = hasMin || hasMax;
        const hasMaterialFilter = material !== undefined && material !== null && String(material).trim() !== "";

        const min = hasMin ? Number(minPrice) : 0;
        const max = hasMax ? Number(maxPrice) : Infinity;
        const safeMin = Number.isFinite(min) ? min : 0;
        const safeMax = Number.isFinite(max) ? max : Infinity;

        const normalizeText = (value) =>
          String(value || "")
            // Normalize for accent-insensitive comparisons.
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[\u00A0]/g, " ")
            .trim();

        // Material key: ignore spaces/dashes to survive inconsistent formatting in stored data.
        const materialKey = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, "");
        const targetMaterial = hasMaterialFilter ? materialKey(material) : "";

        const parsePriceNumber = (value) => {
          if (value === null || value === undefined || value === "") return 0;
          if (typeof value === "number") return Number.isFinite(value) ? value : 0;
          // Accept inputs like "28.888", "28,888", "28 888", "28888₫".
          const digits = String(value).replace(/\D+/g, "");
          if (!digits) return 0;
          const n = Number.parseInt(digits, 10);
          return Number.isFinite(n) ? n : 0;
        };

        if (hasPriceFilter || hasMaterialFilter) {
          filtered = filtered.filter((p) =>
            (p?.variants || []).some((v) => {
              const price = parsePriceNumber(v?.price);
              const priceOk = !hasPriceFilter || (price >= safeMin && price <= safeMax);
              const materialOk = !hasMaterialFilter || materialKey(v?.material) === targetMaterial;
              return priceOk && materialOk;
            })
          );
        }

        // Filter by stock status
        if (stockStatus) {
          filtered = filtered.filter((p) => {
            const totalStock = (p?.variants || []).reduce((sum, v) => sum + (v?.quantity || 0), 0);
            let status;
            if (totalStock === 0) status = "out_of_stock";
            else if (totalStock < 5) status = "low_stock";
            else status = "in_stock";
            return status === stockStatus;
          });
        }

        const total = filtered.length;
        const totalPage = Math.max(Math.ceil(total / limit), 1);
        const safePage = Math.min(page, totalPage);
        const skip = (safePage - 1) * limit;
        const pageItems = filtered.slice(skip, skip + limit);

        const enrichedProducts = pageItems.map(p => ({
          ...p,
          stockStatus: calculateStockStatus(p),
        }));

        return res.status(200).json({
            data: enrichedProducts,
            total,
            currentPage: safePage,
            totalPage,
            limit
        });
    } catch (error) {
        return res.status(500).json({
            message: "Lỗi khi lấy danh sách sản phẩm",
            error: error.message
        });
    }
}

module.exports.createProduct = async (req, res) => {
  try {
    const { name, description, category } = req.body;
    const options = parseJsonField(req.body.options, {});
    const variants = parseJsonField(req.body.variants, []);
    const files = req.files || [];

    const fileMap = {};
    files.forEach(file => {
      if (!fileMap[file.fieldname]) fileMap[file.fieldname] = [];
      fileMap[file.fieldname].push(file.path);
    });

    if (!variants.length) {
      return res.status(400).json({ message: "Chưa có variant nào" });
    }

    const newVariants = [];
    const codesSet = new Set();

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const material = v.material || null;
      const code = helper.generateCodeVariant(material, v.color || "", v.size || "")+helper.generateRandomNumber(4);

   
      if (codesSet.has(code)) {
        return res.status(400).json({ message: `Variant bị trùng trong product: ${code}` });
      }
      codesSet.add(code);

      const images = fileMap[`images-${i}`] || [];

      newVariants.push({
        code,
        material: material || null,
        color: v.color || null,
        size: v.size || null,
        price: Number(v.price) || 0,
        quantity: Number(v.quantity) || 0,
        images
      });
    }

    const materialsFromVariants = [...new Set(newVariants.map((variant) => variant.material).filter(Boolean))];

    const product = new Product({
      name,
      description,
      category,
      options: {
        ...options,
        materials: materialsFromVariants,
      },
      variants: newVariants,
      createdBy: req.account?.id
    });

    await product.save();
    await product.populate({ path: "createdBy", select: "_id fullName email" });
    const enriched = enrichProductWithStatus(product);

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: enriched
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message
    });
  }
};

module.exports.getProductById = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Id không hợp lệ"
      });
    }
 
    const product = await withTimeout(Product.findOne({
      _id: id,
      deleted: false
    }).populate({ path: "category", select: "name" })
      .populate({ path: "createdBy", select: "_id fullName email" }));

    if (!product) {
      return res.status(404).json({
        message: "Không tìm thấy sản phẩm"
      });
    }

    const enriched = enrichProductWithStatus(product);
    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message
    });
  }
};
module.exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Id không hợp lệ"
      });
    }

    const { name, description, category } = req.body;
    const options = parseJsonField(req.body.options, {});
    const variants = parseJsonField(req.body.variants, []);
    const files = req.files || [];

    const product = await withTimeout(Product.findOne({ _id: id, deleted: false }));
    if (!product) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
    }

    const fileMap = {};
    files.forEach(file => {
      if (!fileMap[file.fieldname]) fileMap[file.fieldname] = [];
      fileMap[file.fieldname].push(file.path);
    });

    if (!variants.length) {
      return res.status(400).json({ message: "Chưa có variant nào" });
    }

    const newVariants = [];
    const codesSet = new Set();

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const material = v.material || null;
      let code = v.code;
      if (!code) {
        code =
          helper.generateCodeVariant(
            material,
            v.color || "",
            v.size || ""
          ) + helper.generateRandomNumber(4);
      }

      if (codesSet.has(code)) {
        return res.status(400).json({
          message: `Variant bị trùng trong product: ${code}`
        });
      }
      codesSet.add(code);

      const existingImages = Array.isArray(v.images) ? v.images.filter(Boolean) : [];
      const uploadedImages = fileMap[`images-${i}`] || [];
      const images = [...new Set([...existingImages, ...uploadedImages])];

      newVariants.push({
        code,
        material: material || null,
        color: v.color || null,
        size: v.size || null,
        price: Number(v.price) || 0,
        quantity: Number(v.quantity) || 0,
        images
      });
    }

    product.name = name || product.name;
    product.description = description || product.description;
    product.category = category || product.category;
    const materialsFromVariants = [...new Set(newVariants.map((variant) => variant.material).filter(Boolean))];

    product.options = {
      ...(options || product.options || {}),
      materials: materialsFromVariants,
    };
    product.variants = newVariants;
    product.updatedBy = req.account?.id;

    await product.save();
    await product.populate({ path: "createdBy", select: "_id fullName email" });
    const enriched = enrichProductWithStatus(product);

    return res.json({
      message: "Cập nhật sản phẩm thành công",
      data: enriched
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message
    });
  }
};

module.exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Id không hợp lệ"
      });
    }

    const product = await withTimeout(Product.findOne({ _id: id, deleted: false }));
    if (!product) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
    }

    product.deleted = true;
    product.deletedAt = new Date();
    product.deletedBy = req.account?.id;

    await product.save();

    return res.status(200).json({
      message: "Xóa sản phẩm thành công"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message
    });
  }
}
