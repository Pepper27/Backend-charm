const Category = require("../../models/category.model");
const Product = require("../../models/product.model");
const helper = require("../../helper/generate.helper")
module.exports.getProducts = async (req,res)=>{
    try {
        const find={
            deleted:false
        }
        const {startDate,endDate,keyword} = req.query
        if(startDate && endDate){
            find.createdAt = {
                $gte:new Date(startDate),
                $lte:new Date(endDate)
            }
        }
        if(keyword){
            find.slug = { $regex: keyword, $options: "i" }
        }
        const products = await Product.find(find).lean();
        for(let item of products){
            const cate = await Category.findOne({
                _id:item.category
            })
            if(cate) item.categoryName = cate.name
        }
        return res.status(200).json({
            data: products
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
    const options = JSON.parse(req.body.options || "{}");
    const variants = JSON.parse(req.body.variants || "[]");
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
      const code = helper.generateCodeVariant(v.material, v.color || "", v.size || "")+helper.generateRandomNumber(4);

      // Kiểm tra trùng trong cùng product
      if (codesSet.has(code)) {
        return res.status(400).json({ message: `Variant bị trùng trong product: ${code}` });
      }
      codesSet.add(code);

      const images = fileMap[`images-${i}`] || [];

      newVariants.push({
        code,
        material: v.material || null,
        color: v.color || null,
        size: v.size || null,
        price: Number(v.price) || 0,
        quantity: Number(v.quantity) || 0,
        images
      });
    }

    const product = new Product({
      name,
      description,
      category,
      options,
      variants: newVariants,
      createdBy: req.account?.id
    });

    await product.save();

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: product
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message
    });
  }
};
exports.getProductById = async (req, res) => {}
exports.updateProduct = async (req, res) => {}
exports.deleteProduct = async (req, res) => {}