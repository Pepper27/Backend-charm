const Product = require("../../models/product.model");
const helper = require("../../helper/generate.helper")
const mongoose = require("mongoose");

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
        const {startDate,endDate,keyword,minPrice,maxPrice} = req.query
        if(startDate && endDate){
          find.createdAt = {
            $gte:new Date(startDate),
            $lte:new Date(endDate)
          }
        }
        if(keyword){
            find.slug = { $regex: keyword, $options: "i" }
        }
        const products = await withTimeout(
          Product.find(find)
            .populate({ path: "category", select: "name" })
            .lean()
        );
        let filtered = products;
        const hasMin = minPrice !== undefined && minPrice !== "";
        const hasMax = maxPrice !== undefined && maxPrice !== "";
        if (hasMin || hasMax) {
            const min = hasMin ? Number(minPrice) : 0;
            const max = hasMax ? Number(maxPrice) : Infinity;
            const safeMin = Number.isFinite(min) ? min : 0;
            const safeMax = Number.isFinite(max) ? max : Infinity;

            filtered = products.filter((p) =>
              (p?.variants || []).some((v) => {
                const price = Number(v?.price || 0);
                return price >= safeMin && price <= safeMax;
              })
            );
        }
        const enrichedProducts = filtered.map(p => ({
          ...p,
          stockStatus: calculateStockStatus(p),
        }));
        return res.status(200).json({
            data: enrichedProducts
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
    }));

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
