const Category = require("../../models/category.model");
const Product = require("../../models/product.model");
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
                _id:item.detail.category
            })
            item.detail.categoryName = cate.name
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

exports.getProductById = async (req, res) => {}

exports.createProduct = async (req, res) => {}

exports.updateProduct = async (req, res) => {}

exports.deleteProduct = async (req, res) => {}