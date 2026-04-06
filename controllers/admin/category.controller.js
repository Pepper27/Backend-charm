const Category = require("../../models/category.model")
const categoryHelper = require("../../helper/category.helper")
const AccountAdmin = require("../../models/accountAdmin.model")
const moment = require("moment")
const slugify = require("slugify")
module.exports.createPost = async (req,res) =>{
    try {
        console.log(req.body)
        const existName = await Category.findOne({
            name:req.body.name
        })

        if(req.file){
            req.body.avatar = req.file.path;
        }
        if(!req.body.position){
            const positionCurrent = await Category.countDocuments({
                deleted:false
            })
            req.body.position = positionCurrent+1
        }

        req.body.description = req.body.desc
        if(existName){
            res.json({
                code:"error",
                message:"Tên thể loại đã tồn tại!"
            })
            return;
        }
        req.body.createdBy = req.account.id
        req.body.updatedBy = req.account.id
        const data = new Category(req.body)
        await data.save()
            return res.status(201).json({
            success: true,
            message: "Tạo danh mục thành công!",
            data: data   
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Lỗi server",
            error: error.message
        });
    }

}
module.exports.getCategories = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 6;
        const skip = (page - 1) * limit;
        const keyword = req.query.keyword || ""
        const find ={
            deleted:false
        }
        if (keyword) {
            const slugKeyword = slugify(keyword, {
                lower: true,
                strict: true
            });
            find.slug = { $regex: slugKeyword, $options: "i" };
        }
            console.log(find);
        const categoryList = await Category.find(find)
        .sort({position:1})
        .skip(skip)
        .limit(limit)
        .lean();

        const categoryTotal = await Category.countDocuments({ deleted: false });

        for (const item of categoryList) {
            if (item.createdBy) {
                const createdByName = await AccountAdmin.findOne({
                    _id: item.createdBy
                });
                item.createdByName = createdByName.fullName;
            }

            if (item.updatedBy) {
                const updatedByName = await AccountAdmin.findOne({
                    _id: item.updatedBy
                });
                item.updatedByName = updatedByName.fullName;
            }

            item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
            item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
        }

        return res.status(200).json({
            data: categoryList,
            total: categoryTotal,
            currentPage: page,
            totalPage: Math.ceil(categoryTotal / limit)
        });

    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
};
module.exports.getCategoryById = async (req, res) => {
    try {
        const id = req.params.id
        const categoryCurrent = await Category.findOne({
            _id: id,
            deleted: false
        });
        return res.status(200).json({
            data: categoryCurrent
        });

    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
};
module.exports.updateCategoryById = async (req, res) => {
    try {
        const id = req.params.id
        const old = await Category.findById(id);
        let avatar = old.avatar;
        if (req.file) {
            avatar = req.file.path;
        }
        const updateData = {
            ...req.body,
            avatar
        };
        await Category.updateOne({
            _id: id,
            deleted: false
        },updateData);
        return res.status(200).json({
            code: "success",
            message:"Thành công"
        });

    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
};

module.exports.deleteCategoryById = async (req, res) => {
    try {
        const id = req.params.id;
        await Category.updateOne({
            _id: id,
            deleted: false
        }, {
            deleted: true,
            deletedAt: Date.now(),
            deletedBy: req.account.id
        });
        return res.status(200).json({
            code: "success",
            message: "Xóa danh mục thành công!"
        });
    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
}
module.exports.getCategoriesParent = async (req,res) =>{
    try {
        const arrayCategory = await Category.find({
            deleted:false
        })

        const categoryTree = categoryHelper.categoryTree(arrayCategory,"")
        return res.status(200).json({
            data: categoryTree
        });
    } catch (error) {
        return res.status(500).json({
            message: "Lỗi khi lấy danh sách danh mục",
            error: error.message
        });
   }   
}